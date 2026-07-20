import { callAI } from '../constants/ai';
import { getOllamaSettings, pingOllama, callOllama } from '../constants/ollama';

export interface CoachAIResult {
  text: string;
  source: 'local' | 'cloud';
}

/**
 * Tries the user's local Ollama server first (if enabled and reachable), falling back
 * to the Claude edge function on any failure. The ping+call happen in sequence rather
 * than raced against Claude so a working local server is always preferred.
 */
export async function callCoachAI(
  messages: { role: string; content: string }[],
  system: string | undefined,
  maxTokens = 1000,
): Promise<CoachAIResult> {
  const settings = await getOllamaSettings();

  if (settings.enabled) {
    const reachable = await pingOllama(settings.endpoint);
    if (reachable) {
      try {
        const text = await callOllama(messages, system, settings.endpoint, settings.model, maxTokens);
        return { text, source: 'local' };
      } catch (e) {
        console.log('Ollama call failed, falling back to Claude:', e);
      }
    }
  }

  const text = await callAI(messages, system, maxTokens);
  return { text, source: 'cloud' };
}
