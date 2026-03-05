import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Modal, Image, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';

const fmtTime = (ts: string) => {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const POST_TYPES: Record<string, { emoji: string; color: string }> = {
  progress_photo: { emoji: '📸', color: '#4a9eff' },
  workout:        { emoji: '💪', color: '#4ade80' },
  macro:          { emoji: '🍽️', color: '#fbbf24' },
  milestone:      { emoji: '🏆', color: '#f472b6' },
};

type SocialView = 'feed' | 'leaderboard' | 'post';

export default function SocialScreen({ profile }: { profile: any }) {
  const { user } = useAuth();
  const [view, setView] = useState<SocialView>('feed');
  const [posts, setPosts] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [postModal, setPostModal] = useState(false);
  const [postType, setPostType] = useState('workout');
  const [postCaption, setPostCaption] = useState('');
  const [postImage, setPostImage] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('social_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    console.log('Feed fetch:', error?.message || `${data?.length} posts`);
    setPosts(data || []);
    setLoading(false);
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    // Leaderboard: most macro logs in last 7 days
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { data } = await supabase
      .from('macro_logs')
      .select('user_id, profiles:user_id(name)')
      .gte('created_at', since.toISOString());

    if (!data) return;
    const counts: Record<string, { name: string; count: number; userId: string }> = {};
    data.forEach((row: any) => {
      const uid = row.user_id;
      const name = row.profiles?.name || 'Anonymous';
      if (!counts[uid]) counts[uid] = { name, count: 0, userId: uid };
      counts[uid].count++;
    });
    const sorted = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10);
    setLeaderboard(sorted);
  }, []);

  useEffect(() => {
    fetchFeed();
    fetchLeaderboard();
  }, [fetchFeed, fetchLeaderboard]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPostImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const submitPost = async () => {
    if (!postCaption.trim() && !postImage) {
      Alert.alert('Add a caption or photo to share.'); return;
    }
    setPosting(true);

    let imageUrl = null;
    console.log('postImage present:', !!postImage);
    if (postImage) {
      const base64 = postImage.split(',')[1];
      const filename = `${user!.id}/${Date.now()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('socialimages')
        .upload(filename, decode(base64), { contentType: 'image/jpeg', upsert: true });
      console.log('Upload result:', uploadError?.message || 'success', uploadData?.path);
      if (uploadData) {
        const { data: urlData } = supabase.storage.from('socialimages').getPublicUrl(filename);
        imageUrl = urlData.publicUrl;
        console.log('Image URL:', imageUrl);
      }
    }

    const { error: postError } = await supabase.from('social_posts').insert({
      user_id: user!.id,
      type: postType,
      content: { caption: postCaption.trim(), name: profile.name },
      image_url: imageUrl,
    });
    console.log('Post save:', postError?.message || 'success');

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPostModal(false);
    setPostCaption('');
    setPostImage(null);
    setPosting(false);
    fetchFeed();
  };

  const deletePost = async (id: number) => {
    Alert.alert('Delete Post', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('social_posts').delete().eq('id', id);
        fetchFeed();
      }},
    ]);
  };

  const searchUsers = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase.from('profiles').select('id, name').ilike('name', `%${q}%`).limit(10);
    setSearchResults((data || []).filter((p: any) => p.id !== user!.id));
    setSearching(false);
  };

  // Simple base64 decode for image upload
  function decode(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Social</Text>
        <TouchableOpacity style={s.postBtn} onPress={() => setPostModal(true)}>
          <Text style={s.postBtnText}>+ Share</Text>
        </TouchableOpacity>
      </View>

      {/* Sub tabs */}
      <View style={s.subTabs}>
        {(['feed', 'leaderboard'] as SocialView[]).map(t => (
          <TouchableOpacity key={t} style={[s.subTab, view === t && s.subTabActive]} onPress={() => setView(t)}>
            <Text style={[s.subTabText, view === t && s.subTabTextActive]}>
              {t === 'feed' ? '📣 Feed' : '🏆 Leaderboard'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Feed */}
      {view === 'feed' && (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {/* Search users */}
          <View style={s.searchWrap}>
            <TextInput
              style={s.searchInput}
              placeholder="Find users by name..."
              placeholderTextColor="#444"
              value={searchQuery}
              onChangeText={searchUsers}
            />
          </View>
          {searchResults.length > 0 && (
            <View style={s.searchResults}>
              {searchResults.map((u: any) => (
                <View key={u.id} style={s.searchResult}>
                  <View style={s.avatar}><Text style={s.avatarText}>{u.name?.[0]?.toUpperCase() || '?'}</Text></View>
                  <Text style={s.searchResultName}>{u.name}</Text>
                </View>
              ))}
            </View>
          )}

          {loading && <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />}
          {!loading && posts.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>📣</Text>
              <Text style={s.emptyTitle}>No posts yet</Text>
              <Text style={s.emptySub}>Be the first to share your progress!</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => setPostModal(true)}>
                <Text style={s.emptyBtnText}>+ Share Something</Text>
              </TouchableOpacity>
            </View>
          )}

          {posts.map((post: any) => {
            const typeInfo = POST_TYPES[post.type] || POST_TYPES.milestone;
            const isOwn = post.user_id === user!.id;
            return (
              <View key={post.id} style={s.postCard}>
                <View style={s.postHeader}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{post.content?.name?.[0]?.toUpperCase() || '?'}</Text>
                  </View>
                  <View style={s.postMeta}>
                    <Text style={s.postAuthor}>{post.content?.name || 'User'}</Text>
                    <View style={s.postTypeRow}>
                      <Text style={[s.postTypeBadge, { color: typeInfo.color }]}>{typeInfo.emoji} {post.type.replace('_', ' ')}</Text>
                      <Text style={s.postTime}>{fmtTime(post.created_at)}</Text>
                    </View>
                  </View>
                  {isOwn && (
                    <TouchableOpacity onPress={() => deletePost(post.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.deletePost}>×</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {post.image_url && (
                  <Image source={{ uri: post.image_url }} style={s.postImage} resizeMode="cover" />
                )}

                {post.content?.caption ? (
                  <Text style={s.postCaption}>{post.content.caption}</Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Leaderboard */}
      {view === 'leaderboard' && (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <Text style={s.lbTitle}>Most Active This Week</Text>
          <Text style={s.lbSub}>Ranked by meals logged in the last 7 days</Text>

          {leaderboard.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🏆</Text>
              <Text style={s.emptyTitle}>No data yet</Text>
              <Text style={s.emptySub}>Start logging meals to appear on the leaderboard!</Text>
            </View>
          )}

          {leaderboard.map((entry, i) => {
            const isMe = entry.userId === user!.id;
            const medals = ['🥇', '🥈', '🥉'];
            return (
              <View key={entry.userId} style={[s.lbCard, isMe && s.lbCardMe]}>
                <Text style={s.lbRank}>{i < 3 ? medals[i] : `#${i + 1}`}</Text>
                <View style={[s.avatar, isMe && s.avatarMe]}>
                  <Text style={s.avatarText}>{entry.name?.[0]?.toUpperCase() || '?'}</Text>
                </View>
                <View style={s.lbInfo}>
                  <Text style={[s.lbName, isMe && s.lbNameMe]}>{entry.name}{isMe ? ' (you)' : ''}</Text>
                  <Text style={s.lbCount}>{entry.count} meals logged</Text>
                </View>
                <View style={s.lbBar}>
                  <View style={[s.lbBarFill, {
                    width: `${Math.round(entry.count / (leaderboard[0]?.count || 1) * 100)}%` as any,
                    backgroundColor: isMe ? '#4ade80' : '#333',
                  }]} />
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Post Modal */}
      <Modal visible={postModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPostModal(false)}>
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.handle} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Share</Text>
            <TouchableOpacity style={s.modalClose} onPress={() => setPostModal(false)}>
              <Text style={s.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
            {/* Post type */}
            <Text style={s.fieldLabel}>What are you sharing?</Text>
            <View style={s.typeGrid}>
              {Object.entries(POST_TYPES).map(([key, val]) => (
                <TouchableOpacity
                  key={key}
                  style={[s.typeChip, postType === key && { backgroundColor: val.color + '22', borderColor: val.color }]}
                  onPress={() => setPostType(key)}>
                  <Text style={s.typeChipEmoji}>{val.emoji}</Text>
                  <Text style={[s.typeChipText, postType === key && { color: val.color }]}>
                    {key.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Photo */}
            <Text style={s.fieldLabel}>Photo (optional)</Text>
            <TouchableOpacity style={s.photoBtn} onPress={pickImage}>
              {postImage
                ? <Image source={{ uri: postImage }} style={s.previewImage} />
                : <Text style={s.photoBtnText}>📷  Add Photo</Text>}
            </TouchableOpacity>

            {/* Caption */}
            <Text style={s.fieldLabel}>Caption</Text>
            <TextInput
              style={s.captionInput}
              value={postCaption}
              onChangeText={setPostCaption}
              placeholder="What's on your mind?"
              placeholderTextColor="#444"
              multiline
              maxLength={300}
            />
            <Text style={s.charCount}>{postCaption.length}/300</Text>

            <TouchableOpacity style={s.submitBtn} onPress={submitPost} disabled={posting} activeOpacity={0.8}>
              {posting ? <ActivityIndicator color="#000" /> : <Text style={s.submitBtnText}>Share with Community</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  postBtn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  postBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  subTabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  subTab: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  subTabActive: { backgroundColor: '#fff' },
  subTabText: { fontSize: 13, fontWeight: '700', color: '#555' },
  subTabTextActive: { color: '#000' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  searchWrap: { marginBottom: 12 },
  searchInput: { backgroundColor: '#1a1a1a', borderRadius: 12, color: '#fff', padding: 12, fontSize: 14 },
  searchResults: { backgroundColor: '#1a1a1a', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  searchResult: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  searchResultName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  emptySub: { fontSize: 13, color: '#444', textAlign: 'center', lineHeight: 20 },
  emptyBtn: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  postCard: { backgroundColor: '#1a1a1a', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  postHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  avatarMe: { backgroundColor: '#4ade8022' },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  postMeta: { flex: 1 },
  postAuthor: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 2 },
  postTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postTypeBadge: { fontSize: 11, fontWeight: '700' },
  postTime: { fontSize: 11, color: '#444', fontWeight: '500' },
  deletePost: { color: '#333', fontSize: 22 },
  postImage: { width: '100%', height: 280 },
  postCaption: { fontSize: 14, color: '#ccc', lineHeight: 22, padding: 14, paddingTop: 8, fontWeight: '400' },
  lbTitle: { fontSize: 20, fontWeight: '900', color: '#fff', marginBottom: 4 },
  lbSub: { fontSize: 12, color: '#444', fontWeight: '500', marginBottom: 20 },
  lbCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 14, padding: 14, marginBottom: 8, gap: 12 },
  lbCardMe: { backgroundColor: '#1a2a1a' },
  lbRank: { fontSize: 18, width: 32, textAlign: 'center' },
  lbInfo: { flex: 1 },
  lbName: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  lbNameMe: { color: '#4ade80' },
  lbCount: { fontSize: 11, color: '#555', fontWeight: '600' },
  lbBar: { width: 60, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, overflow: 'hidden' },
  lbBarFill: { height: 4, borderRadius: 2 },
  modalSafe: { flex: 1, backgroundColor: '#1a1a1a' },
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  modalClose: { backgroundColor: '#252525', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: '#888', fontSize: 20, lineHeight: 22 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#252525', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'transparent' },
  typeChipEmoji: { fontSize: 16 },
  typeChipText: { fontSize: 13, fontWeight: '700', color: '#555' },
  photoBtn: { backgroundColor: '#252525', borderRadius: 12, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 20, overflow: 'hidden' },
  photoBtnText: { color: '#555', fontSize: 15, fontWeight: '700' },
  previewImage: { width: '100%', height: 120 },
  captionInput: { backgroundColor: '#252525', borderRadius: 12, color: '#fff', padding: 14, fontSize: 15, minHeight: 100, textAlignVertical: 'top', marginBottom: 4 },
  charCount: { fontSize: 11, color: '#444', textAlign: 'right', marginBottom: 20 },
  submitBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 20 },
  submitBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
});
