import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface YoutubeLink {
  title: string;
  url: string;
}

function extractLinks(text: string): { clean: string; links: YoutubeLink[] } {
  const links: YoutubeLink[] = [];
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[2].includes('youtube.com') || match[2].includes('youtu.be')) {
      links.push({ title: match[1], url: match[2] });
    }
  }
  const clean = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1');
  return { clean, links };
}

const SYSTEM_PROMPT = `You are an expert personal trainer and strength coach AI assistant built into a fitness app called Macro Log. You help users with:
- Exercise form and technique
- How to perform specific lifts safely
- Training programming advice
- Injury prevention
- General fitness questions

When explaining exercises, always cover: setup/starting position, execution, common mistakes, and key cues.

When relevant, include YouTube links to reputable coaches in markdown format like [Video Title](youtube_url). Use channels like Alan Thrall, Jeff Nippard, Renaissance Periodization, Athlean-X, or Starting Strength for reference videos. Only include real, well-known videos you're confident exist.

Keep responses concise but thorough. Use short paragraphs. Be encouraging and practical.`;

export default function CoachScreen({ initialExercise }: { initialExercise?: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: initialExercise
        ? `Hey! Let's talk about the **${initialExercise}**. I'll break down the form, key cues, and common mistakes. What would you like to know?`
        : `Hey! I'm your AI coach 💪\n\nAsk me anything — how to do a lift, form tips, what muscles an exercise targets, programming questions, or anything else fitness related.\n\nWhat's on your mind?`,
    },
  ]);
  const [input, setInput] = useState(initialExercise ? `How do I do the ${initialExercise} properly?` : '');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (initialExercise) {
      setTimeout(() => sendMessage(`How do I do the ${initialExercise} properly?`), 500);
    }
  }, []);

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText) return;
    const userMsg: Message = { role: 'user', content: messageText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    scrollRef.current?.scrollToEnd({ animated: true });

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const reply = data.content?.find((b: any) => b.type === 'text')?.text || 'Sorry, I could not get a response.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error — please try again.' }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const renderMessage = (msg: Message, i: number) => {
    const isUser = msg.role === 'user';
    const { clean, links } = extractLinks(msg.content);

    // Simple bold markdown
    const parts = clean.split(/\*\*([^*]+)\*\*/g);

    return (
      <View key={i} style={[s.msgWrap, isUser && s.msgWrapUser]}>
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAssistant]}>
          <Text style={[s.bubbleText, isUser && s.bubbleTextUser]}>
            {parts.map((part, pi) =>
              pi % 2 === 1
                ? <Text key={pi} style={s.bold}>{part}</Text>
                : part
            )}
          </Text>
          {links.map((link, li) => (
            <TouchableOpacity key={li} style={s.ytLink} onPress={() => Linking.openURL(link.url)}>
              <Text style={s.ytIcon}>▶</Text>
              <Text style={s.ytTitle} numberOfLines={1}>{link.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>AI Coach</Text>
        <Text style={s.subtitle}>Powered by Claude</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex} keyboardVerticalOffset={0}>
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map(renderMessage)}
          {loading && (
            <View style={s.msgWrap}>
              <View style={[s.bubble, s.bubbleAssistant, s.loadingBubble]}>
                <ActivityIndicator color="#555" size="small" />
              </View>
            </View>
          )}
        </ScrollView>

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything about training…"
            placeholderTextColor="#444"
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage()}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || loading}>
            <Text style={s.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  flex: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: '#444', fontWeight: '600', marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 8 },
  msgWrap: { marginBottom: 12, alignItems: 'flex-start' },
  msgWrapUser: { alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: 18, padding: 14 },
  bubbleAssistant: { backgroundColor: '#1a1a1a', borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: '#fff', borderBottomRightRadius: 4 },
  loadingBubble: { paddingVertical: 16, paddingHorizontal: 20 },
  bubbleText: { fontSize: 15, color: '#fff', lineHeight: 22 },
  bubbleTextUser: { color: '#000' },
  bold: { fontWeight: '800' },
  ytLink: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff0000', borderRadius: 8, padding: 8, marginTop: 8, gap: 8 },
  ytIcon: { color: '#fff', fontSize: 12, fontWeight: '900' },
  ytTitle: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  inputRow: { flexDirection: 'row', padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: '#1e1e1e', alignItems: 'flex-end' },
  input: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 20, color: '#fff', paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, maxHeight: 120 },
  sendBtn: { backgroundColor: '#fff', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#222' },
  sendBtnText: { color: '#000', fontSize: 20, fontWeight: '900', lineHeight: 22 },
});
