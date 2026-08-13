import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { logError } from '../utils/logError';

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
  componentStack: string | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    // Report to Sentry — this boundary used to swallow the error, which meant a
    // caught render crash was invisible everywhere except the device console.
    logError(`ErrorBoundary:${this.props.fallbackTitle ?? 'screen'}`, error);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    if (this.state.error) {
      // First meaningful frame of the component stack — names the component
      // that threw, which is usually 90% of the diagnosis.
      const stackLine = (this.state.componentStack ?? '')
        .split('\n').map(l => l.trim()).filter(Boolean)[0] ?? '';
      return (
        <View style={s.container}>
          <Text style={s.title}>{this.props.fallbackTitle ?? 'Something went wrong'}</Text>
          <Text style={s.message}>This screen hit an unexpected error. Try again.</Text>
          {/* Beta diagnostics: surface the real error so testers can screenshot
              it. Consider hiding behind a "tap title 5×" gate for public launch. */}
          <Text style={s.debug} numberOfLines={6}>
            {String(this.state.error?.message ?? this.state.error)}
            {stackLine ? `\n${stackLine}` : ''}
          </Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => this.setState({ error: null, componentStack: null })}>
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
  message: { color: '#888888', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  debug: { color: '#5A5D60', fontSize: 11, textAlign: 'center', marginBottom: 20, fontFamily: 'Menlo' },
  retryBtn: { backgroundColor: '#C8FF3D', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#08090B', fontWeight: '700', fontSize: 14 },
});
