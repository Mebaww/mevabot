import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const groq = new Groq({ apiKey: config.groq.apiKey });

export type Message = ChatCompletionMessageParam;

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
}

// Tries each model in order and returns the first successful reply.
// Skips a model on 404 / not-found — anything else throws immediately.
export async function chat(messages: Message[], opts: ChatOptions = {}): Promise<string> {
  const { maxTokens = 1500, temperature = 0.7 } = opts;

  for (const model of config.groq.models) {
    try {
      const res = await groq.chat.completions.create({ model, messages, temperature, max_tokens: maxTokens });
      const text = res.choices[0]?.message?.content;
      if (!text) throw new Error('Empty response');

      logger.debug('Groq OK', { model, tokens: res.usage?.total_tokens });
      return text;
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      const goneOrBusy =
        e.status === 404 ||
        e.status === 429 ||
        e.message?.includes('model_not_found') ||
        e.message?.includes('does not exist') ||
        e.message?.includes('not available') ||
        e.message?.includes('decommissioned') ||
        e.message?.includes('model_decommissioned');

      if (goneOrBusy) {
        logger.warn(`Model ${model} unavailable or busy, falling back`, { model, status: e.status });
        continue;
      }

      logger.error('Groq error', { model, status: e.status, message: e.message });
      throw err;
    }
  }

  throw new Error('No Groq models available. Check GROQ_MODELS or your API key tier.');
}
