import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Catches JS render/lifecycle errors so one broken screen doesn't crash the whole
// app. NOTE: this only catches JS exceptions — it cannot catch a native crash
// (e.g. EXC_BAD_ACCESS inside a native module like react-native-health), since
// those abort the process before React's error handling ever runs.
interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={s.container}>
          <Text style={s.title}>{this.props.fallbackTitle ?? 'Something went wrong'}</Text>
          <Text style={s.message}>This screen hit an unexpected error. Try again.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => this.setState({ error: null })}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#08090B' },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  message: { color: '#888888', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  retryBtn: { backgroundColor: '#C8FF3D', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#08090B', fontWeight: '700', fontSize: 14 },
});
