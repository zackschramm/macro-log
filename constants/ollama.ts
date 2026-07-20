import AsyncStorage from '@react-native-async-storage/async-storage';

export const OLLAMA_ENABLED_KEY = 'fuelog_ollama_enabled';
export const OLLAMA_ENDPOINT_KEY = 'fuelog_ollama_endpoint';
export const OLLAMA_MODEL_KEY = 'fuelog_ollama_model';

export const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1';

export interface OllamaSettings {
  enabled: boolean;
  endpoint: string;
  model: string;
}

export async function getOllamaSettings(): Promise<OllamaSettings> {
  const values = await AsyncStorage.multiGet([OLLAMA_ENABLED_KEY, OLLAMA_ENDPOINT_KEY, OLLAMA_MODEL_KEY]);
  const map = Object.fromEntries(values);
  return {
    enabled: map[OLLAMA_ENABLED_KEY] === '1',
    endpoint: map[OLLAMA_ENDPOINT_KEY] || DEFAULT_OLLAMA_ENDPOINT,
    model: map[OLLAMA_MODEL_KEY] || DEFAULT_OLLAMA_MODEL,
  };
}

export async function setOllamaSettings(settings: Partial<OllamaSettings>): Promise<void> {
  const pairs: [string, string][] = [];
  if (settings.enabled !== undefined) pairs.push([OLLAMA_ENABLED_KEY, settings.enabled ? '1' : '0']);
  if (settings.endpoint !== undefined) pairs.push([OLLAMA_ENDPOINT_KEY, settings.endpoint]);
  if (settings.model !== undefined) pairs.push([OLLAMA_MODEL_KEY, settings.model]);
  if (pairs.length) await AsyncStorage.multiSet(pairs);
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

/** Quick reachability check — used before committing to a full chat request. */
export async function pingOllama(endpoint: string, timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${normalizeEndpoint(endpoint)}/api/tags`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Calls a local Ollama server's chat endpoint. Throws on any failure — caller decides fallback. */
export async function callOllama(
  messages: { role: string; content: string }[],
  system: string | undefined,
  endpoint: string,
  model: string,
  maxTokens = 1000,
  timeoutMs = 30000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const chatMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
    const res = await fetch(`${normalizeEndpoint(endpoint)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: chatMessages,
        stream: false,
        options: { num_predict: maxTokens },
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.message?.content;
    if (!text) throw new Error('Ollama returned no content');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
