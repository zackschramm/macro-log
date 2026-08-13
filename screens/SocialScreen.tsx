import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Modal, Image, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { POST_TYPE_ICONS, type IconName } from '../constants/icons';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { logError } from '../utils/logError';
import { MC } from '../constants/data';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

const fmtTime = (ts: string) => {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const POST_TYPES: Record<string, { icon: IconName; color: string }> = {
  progress_photo: { icon: POST_TYPE_ICONS.progress_photo, color: '#4F9CFF' },
  workout:        { icon: POST_TYPE_ICONS.workout,        color: '#C8FF3D' },
  macro:          { icon: POST_TYPE_ICONS.macro,          color: '#F5A623' },
  milestone:      { icon: POST_TYPE_ICONS.milestone,      color: '#F472B6' },
};

type SocialView = 'feed' | 'myposts' | 'leaderboard';

export default function SocialScreen({ profile }: { profile: any }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
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
  const [myPosts, setMyPosts] = useState<any[]>([]);
  const [likes, setLikes] = useState<Record<number, { count: number; liked: boolean }>>({});
  const [commentModal, setCommentModal] = useState<number | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

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

  const fetchMyPosts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('social_posts')
      .select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setMyPosts(data || []);
  }, [user]);

  const fetchLeaderboard = useCallback(async () => {
    // RLS keeps macro_logs own-rows-only, so cross-user counts come from a
    // security-definer RPC (supabase/migrations/20260719_social.sql).
    const { data, error } = await supabase.rpc('get_leaderboard', { days: 7 });
    console.log('Leaderboard fetch:', error?.message || `${data?.length} rows`);
    if (!data) return;
    setLeaderboard(data.map((row: any) => ({
      name: row.name || 'Anonymous',
      count: Number(row.count),
      userId: row.user_id,
    })));
  }, []);

  // Social is 18+. Age comes from the user's profile (set during onboarding).
  // Missing/unknown age is treated as under 18 (fail closed).
  const socialAllowed = Number(profile?.age) >= 18;

  useEffect(() => {
    if (!socialAllowed) return;
    fetchFeed();
    fetchLeaderboard();
    fetchMyPosts();
  }, [socialAllowed, fetchFeed, fetchLeaderboard, fetchMyPosts]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPostImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const fetchLikes = async (postIds: number[]) => {
    if (!postIds.length) return;
    const { data: likeCounts } = await supabase.from('post_likes').select('post_id').in('post_id', postIds);
    const { data: myLikes } = await supabase.from('post_likes').select('post_id').eq('user_id', user!.id).in('post_id', postIds);
    const myLikeSet = new Set((myLikes || []).map((l: any) => l.post_id));
    const counts: Record<number, number> = {};
    (likeCounts || []).forEach((l: any) => { counts[l.post_id] = (counts[l.post_id] || 0) + 1; });
    const newLikes: Record<number, { count: number; liked: boolean }> = {};
    postIds.forEach(id => { newLikes[id] = { count: counts[id] || 0, liked: myLikeSet.has(id) }; });
    setLikes(newLikes);
  };

  const toggleLike = async (postId: number) => {
    const current = likes[postId] || { count: 0, liked: false };
    if (current.liked) {
      await supabase.from('post_likes').delete().eq('user_id', user!.id).eq('post_id', postId);
      setLikes(prev => ({ ...prev, [postId]: { count: prev[postId].count - 1, liked: false } }));
    } else {
      await supabase.from('post_likes').insert({ user_id: user!.id, post_id: postId });
      setLikes(prev => ({ ...prev, [postId]: { count: (prev[postId]?.count || 0) + 1, liked: true } }));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const openComments = async (postId: number) => {
    setCommentModal(postId);
    setLoadingComments(true);
    const { data } = await supabase.from('post_comments').select('*').eq('post_id', postId).order('created_at');
    setComments(data || []);
    setLoadingComments(false);
  };

  const submitComment = async () => {
    if (!commentText.trim() || !commentModal) return;
    setPostingComment(true);
    await supabase.from('post_comments').insert({
      user_id: user!.id, post_id: commentModal,
      content: commentText.trim(), author_name: profile.name,
    });
    setCommentText('');
    const { data } = await supabase.from('post_comments').select('*').eq('post_id', commentModal).order('created_at');
    setComments(data || []);
    setPostingComment(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const submitPost = async () => {
    if (!postCaption.trim() && !postImage) {
      Alert.alert('Add a caption or photo to share.'); return;
    }
    setPosting(true);

    // Upload the photo to storage and store the PUBLIC URL. This used to put
    // the device-local value (a data: URI from the picker, or file:// from the
    // camera path) straight into social_posts.image_url — so photo posts
    // either bloated the row with megabytes of base64 or rendered only on the
    // author's own phone while everyone else saw a broken image. The path is
    // {userId}/... to match the bucket's per-user folder convention, which is
    // also what delete-account's storage purge walks.
    let imageUrl: string | null = null;
    if (postImage) {
      try {
        const base64 = postImage.startsWith('data:')
          ? postImage.slice(postImage.indexOf(',') + 1)
          : null;
        if (!base64) throw new Error('unsupported image source (expected base64 data URI)');
        const path = `${user!.id}/post-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      } catch (e) {
        logError('Social.imageUpload', e);
        setPosting(false);
        Alert.alert('Photo upload failed', 'Your post was not shared — try again, or post without the photo.');
        return;
      }
    }

    const { error: postError } = await supabase.from('social_posts').insert({
      user_id: user!.id,
      type: postType,
      content: { caption: postCaption.trim(), name: profile.name },
      image_url: imageUrl,
    });
    // A failed insert used to close the modal, clear the caption and refresh
    // the feed anyway — the post vanished with full success UX.
    if (postError) {
      logError('Social.post', postError);
      setPosting(false);
      Alert.alert('Not shared', 'Could not share this post — check your connection and try again.');
      return;
    }

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
        fetchMyPosts();
      }},
    ]);
  };

  const searchUsers = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    // public_profiles view exposes only id + name across users (profiles RLS stays private).
    const { data } = await supabase.from('public_profiles').select('id, name').ilike('name', `%${q}%`).limit(10);
    setSearchResults((data || []).filter((p: any) => p.id !== user!.id));
    setSearching(false);
  };

  function decode(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // 18+ gate — rendered in place of the entire social experience.
  if (!socialAllowed) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Social</Text>
        </View>
        <View style={s.empty}>
          <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
          <Text style={s.emptyTitle}>Social is 18+</Text>
          <Text style={s.emptySub}>
            The community feed, sharing, and leaderboard are only available to
            users 18 or older. All other Fuelog features are fully available to
            you.
          </Text>
        </View>
      </SafeAreaView>
    );
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
        {([
          { key: 'feed', label: 'Feed' },
          { key: 'myposts', label: 'My Posts' },
          { key: 'leaderboard', label: 'Board' },
        ] as { key: SocialView; label: string }[]).map(t => (
          <TouchableOpacity key={t.key} style={[s.subTab, view === t.key && s.subTabActive]} onPress={() => setView(t.key)}>
            <Text style={[s.subTabText, view === t.key && s.subTabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Feed */}
      {view === 'feed' && (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <View style={s.searchWrap}>
            <TextInput
              style={s.searchInput}
              placeholder="Find users by name..."
              placeholderTextColor={colors.textTertiary}
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

          {loading && <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />}
          {!loading && posts.length === 0 && (
            <View style={s.empty}>
              <Ionicons name="megaphone-outline" size={40} color={colors.textTertiary} />
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
                      <View style={s.postTypeChip}>
                        <Ionicons name={typeInfo.icon} size={13} color={typeInfo.color} />
                        <Text style={[s.postTypeBadge, { color: typeInfo.color }]}>{post.type.replace('_', ' ')}</Text>
                      </View>
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

      {/* My Posts */}
      {view === 'myposts' && (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {myPosts.length === 0 && (
            <View style={s.empty}>
              <Ionicons name="camera-outline" size={40} color={colors.textTertiary} />
              <Text style={s.emptyTitle}>No posts yet</Text>
              <Text style={s.emptySub}>Share your progress with the community!</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => setPostModal(true)}>
                <Text style={s.emptyBtnText}>+ Share Something</Text>
              </TouchableOpacity>
            </View>
          )}
          {myPosts.map((post: any) => {
            const typeInfo = POST_TYPES[post.type] || POST_TYPES.milestone;
            return (
              <View key={post.id} style={s.postCard}>
                <View style={s.postHeader}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{post.content?.name?.[0]?.toUpperCase() || '?'}</Text>
                  </View>
                  <View style={s.postMeta}>
                    <Text style={s.postAuthor}>{post.content?.name || 'You'}</Text>
                    <View style={s.postTypeRow}>
                      <View style={s.postTypeChip}>
                        <Ionicons name={typeInfo.icon} size={13} color={typeInfo.color} />
                        <Text style={[s.postTypeBadge, { color: typeInfo.color }]}>{post.type.replace('_', ' ')}</Text>
                      </View>
                      <Text style={s.postTime}>{fmtTime(post.created_at)}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => deletePost(post.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={s.deletePost}>×</Text>
                  </TouchableOpacity>
                </View>
                {post.image_url && (
                  <Image source={{ uri: post.image_url }} style={s.postImage} resizeMode="cover" />
                )}
                {post.content?.caption ? (
                  <Text style={s.postCaption}>{post.content.caption}</Text>
                ) : null}
                <View style={s.postActions}>
                  <TouchableOpacity style={s.actionBtn} onPress={() => toggleLike(post.id)}>
                    <Ionicons name={likes[post.id]?.liked ? "heart" : "heart-outline"} size={18} color={likes[post.id]?.liked ? "#F472B6" : colors.textTertiary} />
                    <Text style={[s.actionText, likes[post.id]?.liked && s.actionTextLiked]}>{likes[post.id]?.count || 0}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => openComments(post.id)}>
                    <Ionicons name="chatbubble-outline" size={18} color={colors.textTertiary} />
                    <Text style={s.actionText}>Comment</Text>
                  </TouchableOpacity>
                </View>
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
              <Ionicons name="trophy-outline" size={40} color={colors.textTertiary} />
              <Text style={s.emptyTitle}>No data yet</Text>
              <Text style={s.emptySub}>Start logging meals to appear on the leaderboard!</Text>
            </View>
          )}

          {leaderboard.map((entry, i) => {
            const isMe = entry.userId === user!.id;
            const medalColors = ['#F5C518', '#C0C4CC', '#CD7F32'];
            return (
              <View key={entry.userId} style={[s.lbCard, isMe && s.lbCardMe]}>
                <Text style={[s.lbRank, i < 3 && { color: medalColors[i] }]}>#{i + 1}</Text>
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
                    backgroundColor: isMe ? colors.accent : colors.borderStrong,
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

          <ScrollView style={{ flex: 1, paddingHorizontal: spacing.xl }} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>What are you sharing?</Text>
            <View style={s.typeGrid}>
              {Object.entries(POST_TYPES).map(([key, val]) => (
                <TouchableOpacity
                  key={key}
                  style={[s.typeChip, postType === key && { backgroundColor: val.color + '22', borderColor: val.color }]}
                  onPress={() => setPostType(key)}>
                  <Ionicons name={val.icon} size={16} color={val.color} />
                  <Text style={[s.typeChipText, postType === key && { color: val.color }]}>
                    {key.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>Photo (optional)</Text>
            <TouchableOpacity style={s.photoBtn} onPress={pickImage}>
              {postImage
                ? <Image source={{ uri: postImage }} style={s.previewImage} />
                : <Text style={s.photoBtnText}>Add Photo</Text>}
            </TouchableOpacity>

            <Text style={s.fieldLabel}>Caption</Text>
            <TextInput
              style={s.captionInput}
              value={postCaption}
              onChangeText={setPostCaption}
              placeholder="What's on your mind?"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={300}
            />
            <Text style={s.charCount}>{postCaption.length}/300</Text>

            <TouchableOpacity style={s.submitBtn} onPress={submitPost} disabled={posting} activeOpacity={0.8}>
              {posting
                ? <ActivityIndicator color={colors.accentText} />
                : <Text style={s.submitBtnText}>Share with Community</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    postBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
    postBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    subTabs: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: c.border },
    subTab: { flex: 1, backgroundColor: c.card, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: c.border },
    subTabActive: { backgroundColor: c.accent, borderColor: c.accent },
    subTabText: { fontSize: 13, fontWeight: weight.bold, color: c.textTertiary },
    subTabTextActive: { color: c.accentText },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    searchWrap: { marginBottom: 12 },
    searchInput: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: spacing.md, fontSize: 14, borderWidth: 1, borderColor: c.border },
    searchResults: { backgroundColor: c.card, borderRadius: radius.md, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    searchResult: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: 10, borderBottomWidth: 1, borderBottomColor: c.border },
    searchResultName: { fontSize: 15, fontWeight: weight.semibold, color: c.text },
    empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text },
    emptySub: { fontSize: 13, color: c.textTertiary, textAlign: 'center', lineHeight: 20 },
    emptyBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
    emptyBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    postCard: { backgroundColor: c.card, borderRadius: radius.card, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    postHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.cardAlt, alignItems: 'center', justifyContent: 'center' },
    avatarMe: { backgroundColor: c.accentMuted },
    avatarText: { color: c.text, fontSize: 15, fontWeight: weight.heavy },
    postMeta: { flex: 1 },
    postAuthor: { fontSize: 14, fontWeight: weight.heavy, color: c.text, marginBottom: 2 },
    postTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    postTypeBadge: { fontSize: 11, fontWeight: weight.bold },
    postTime: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium },
    deletePost: { color: c.textTertiary, fontSize: 22 },
    postImage: { width: '100%', height: 280 },
    postCaption: { fontSize: 14, color: c.textSecondary, lineHeight: 22, padding: 14, paddingTop: 8, fontWeight: weight.regular },
    postActions: { flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 12, gap: 16 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionIcon: { fontSize: 16 },
    actionText: { fontSize: 13, color: c.textTertiary, fontWeight: weight.bold },
    actionTextLiked: { color: c.danger },
    lbTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text, marginBottom: 4 },
    lbSub: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 20 },
    lbCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.card, padding: 14, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: c.border },
    lbCardMe: { backgroundColor: c.accentMuted, borderColor: c.accentDim },
    lbRank: { fontSize: 18, width: 32, textAlign: 'center' },
    lbInfo: { flex: 1 },
    lbName: { fontSize: 15, fontWeight: weight.bold, color: c.text, marginBottom: 2 },
    lbNameMe: { color: c.accent },
    lbCount: { fontSize: 11, color: c.textTertiary, fontWeight: weight.semibold },
    lbBar: { width: 60, height: 4, backgroundColor: c.border, borderRadius: 2, overflow: 'hidden' },
    lbBarFill: { height: 4, borderRadius: 2 },
    modalSafe: { flex: 1, backgroundColor: c.bgSecondary },
    handle: { width: 36, height: 4, backgroundColor: c.borderStrong, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: 20 },
    modalTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    modalClose: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    modalCloseText: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    fieldLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
    typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
    typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.cardAlt, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'transparent' },
    postTypeChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    typeChipText: { fontSize: 13, fontWeight: weight.bold, color: c.textTertiary },
    photoBtn: { backgroundColor: c.cardAlt, borderRadius: radius.md, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 20, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    photoBtnText: { color: c.textTertiary, fontSize: 15, fontWeight: weight.bold },
    previewImage: { width: '100%', height: 120 },
    captionInput: { backgroundColor: c.cardAlt, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, minHeight: 100, textAlignVertical: 'top', marginBottom: 4, borderWidth: 1, borderColor: c.border },
    charCount: { fontSize: 11, color: c.textTertiary, textAlign: 'right', marginBottom: 20 },
    submitBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginBottom: 20 },
    submitBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
  });
}
