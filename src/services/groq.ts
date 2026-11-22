import Groq from 'groq-sdk';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'groq-sdk/resources/chat/completions.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { ToolDefinition } from '../types/plugin.js';

const groq = new Groq({ apiKey: config.groq.apiKey });

export type Message = ChatCompletionMessageParam;

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface GroqUsageMetrics {
  lastModel: string;
  limitRequests: number;
  limitTokens: number;
  remainingRequests: number;
  remainingTokens: number;
  resetRequests: string;
  resetTokens: string;
  lastTurnTokens: number;
  cumulativeTokens: number;
  updatedAt: string;
}

let latestUsage: GroqUsageMetrics = {
  lastModel: config.groq.models[0] ?? 'unknown',
  limitRequests: 0,
  limitTokens: 0,
  remainingRequests: 0,
  remainingTokens: 0,
  resetRequests: '0s',
  resetTokens: '0s',
  lastTurnTokens: 0,
  cumulativeTokens: 0,
  updatedAt: 'never',
};

/**
 * Returns the latest real-time rate limit headers and token stats.
 */
export function getGroqUsageStats(): GroqUsageMetrics {
  return { ...latestUsage };
}

/**
 * Fetches the live list of all active models available on this Groq account.
 */
export async function getActiveGroqModels(): Promise<Array<{ id: string; owned_by: string }>> {
  try {
    const res = await groq.models.list();
    return res.data
      .filter((m) => (m as { active?: boolean }).active !== false && !m.id.includes('guard') && !m.id.includes('whisper'))
      .map((m) => ({ id: m.id, owned_by: m.owned_by }));
  } catch (err: unknown) {
    logger.error('Failed to list Groq models', { message: (err as Error).message });
    return [];
  }
}

const MAX_TOOL_ITERATIONS = 3;

/**
 * Sends a conversation to Groq with automatic model fallback, rate limit tracking,
 * and agentic tool-calling.
 */
export async function chat(messages: Message[], opts: ChatOptions = {}): Promise<string> {
  const { maxTokens = 1500, temperature = 0.7, tools } = opts;

  const groqTools: ChatCompletionTool[] | undefined =
    tools && tools.length > 0
      ? tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

  const currentMessages: ChatCompletionMessageParam[] = [...messages];

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    let responseChoice;

    for (const model of config.groq.models) {
      try {
        const { data: res, response } = await groq.chat.completions.create({
          model,
          messages: currentMessages,
          temperature,
          max_tokens: maxTokens,
          tools: groqTools,
          tool_choice: groqTools ? 'auto' : undefined,
        }).withResponse();

        responseChoice = res.choices[0];
        if (!responseChoice) throw new Error('Empty choice returned from model');

        const choiceMessage = responseChoice.message;
        const hasTools = Boolean(choiceMessage.tool_calls && choiceMessage.tool_calls.length > 0 && tools);
        const content = (choiceMessage.content || '').trim();

        // If no tool call and no text content was produced, fall back to next model
        if (!hasTools && !content) {
          logger.warn(`Model ${model} returned empty content, falling back to next model`, {
            model,
            finish_reason: responseChoice.finish_reason,
          });
          continue;
        }

        // If truncated mid-sentence due to max_tokens limit
        if (!hasTools && responseChoice.finish_reason === 'length' && content.length < 350) {
          logger.warn(`Model ${model} cut off prematurely due to token length limit, falling back to next model`, {
            model,
            length: content.length,
          });
          continue;
        }

        // Track live rate limit headers & token consumption
        const totalTokens = res.usage?.total_tokens ?? 0;
        latestUsage = {
          lastModel: model,
          limitRequests: parseInt(response.headers.get('x-ratelimit-limit-requests') || '0', 10),
          limitTokens: parseInt(response.headers.get('x-ratelimit-limit-tokens') || '0', 10),
          remainingRequests: parseInt(response.headers.get('x-ratelimit-remaining-requests') || '0', 10),
          remainingTokens: parseInt(response.headers.get('x-ratelimit-remaining-tokens') || '0', 10),
          resetRequests: response.headers.get('x-ratelimit-reset-requests') || '0s',
          resetTokens: response.headers.get('x-ratelimit-reset-tokens') || '0s',
          lastTurnTokens: totalTokens,
          cumulativeTokens: latestUsage.cumulativeTokens + totalTokens,
          updatedAt: new Date().toISOString(),
        };

        logger.debug('Groq OK', { model, tokens: totalTokens, iteration });
        break;
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

    if (!responseChoice) {
      throw new Error('No Groq models available. Check GROQ_MODELS or your API key tier.');
    }

    const { message } = responseChoice;

    // Check if the model decided to execute one or more tools
    if (message.tool_calls && message.tool_calls.length > 0 && tools) {
      currentMessages.push(message);

      for (const call of message.tool_calls) {
        const tool = tools.find((t) => t.name === call.function.name);
        let toolOutput = '';

        if (!tool) {
          toolOutput = JSON.stringify({ error: `Tool "${call.function.name}" is not implemented.` });
        } else {
          try {
            const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            logger.info('Executing agentic tool', { tool: tool.name, args });
            toolOutput = await tool.execute(args);
          } catch (err: unknown) {
            logger.error('Tool execution failed', { tool: tool.name, error: (err as Error).message });
            toolOutput = JSON.stringify({ error: (err as Error).message });
          }
        }

        currentMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolOutput,
        });
      }

      // Next iteration sends tool results back to Groq for natural response synthesis
      continue;
    }

    // Final answer generated
    const text = message.content;
    if (!text) throw new Error('Empty response from model');
    return text;
  }

  throw new Error('Tool iteration limit exceeded');
}
