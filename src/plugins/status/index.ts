import { execFile }                        from 'node:child_process';
import { promisify }                       from 'node:util';
import { replySafe }                       from '../../utils/format.js';
import { logger }                          from '../../utils/logger.js';
import { getGroqUsageStats, getActiveGroqModels } from '../../services/groq.js';
import type { Plugin }                     from '../../types/plugin.js';

const exec = promisify(execFile);

// 5s timeout so a hung binary doesn't freeze the bot
async function run(bin: string, args: string[]): Promise<string> {
  const { stdout } = await exec(bin, args, { timeout: 5000 });
  return stdout.trim();
}

export interface VpsMetrics {
  uptime: string;
  ram: { used: string; total: string };
  disk: { used: string; total: string; percent: string };
}

/**
 * Reads real-time Linux host metrics.
 */
export async function getVpsMetrics(): Promise<VpsMetrics> {
  const [uptime, freeOut, dfOut] = await Promise.all([
    run('uptime', ['-p']),
    run('free', ['-h']),
    run('df', ['-h', '/']),
  ]);

  const mem  = freeOut.split('\n').find((l) => l.startsWith('Mem:'))?.split(/\s+/) ?? [];
  const disk = dfOut.split('\n').find((l) => l.includes('/'))?.split(/\s+/) ?? [];

  return {
    uptime,
    ram: { used: mem[2] ?? '?', total: mem[1] ?? '?' },
    disk: { used: disk[2] ?? '?', total: disk[1] ?? '?', percent: disk[4] ?? '?' },
  };
}

export const statusPlugin: Plugin = {
  name: 'status',
  commands: [
    {
      command: 'status',
      description: 'Show VPS metrics',
      async handler(ctx) {
        try {
          const stats = await getVpsMetrics();
          await replySafe(
            ctx,
            `**VPS Status**\n` +
            `• Uptime: ${stats.uptime}\n` +
            `• RAM: ${stats.ram.used} / ${stats.ram.total}\n` +
            `• Disk: ${stats.disk.used} / ${stats.disk.total} (${stats.disk.percent})`,
          );
        } catch (err: unknown) {
          logger.error('Status failed', { message: (err as Error).message });
          await ctx.reply('Could not read system stats.');
        }
      },
    },
    {
      command: 'groq',
      description: 'Check Groq API rate limits',
      async handler(ctx) {
        const usage = getGroqUsageStats();
        if (usage.updatedAt === 'never') {
          await replySafe(ctx, 'No Groq requests completed yet this session.');
          return;
        }

        await replySafe(
          ctx,
          `**Groq API** (\`${usage.lastModel}\`)\n\n` +
          `• Tokens: ${usage.remainingTokens.toLocaleString()} / ${usage.limitTokens.toLocaleString()} (reset in ${usage.resetTokens})\n` +
          `• Requests: ${usage.remainingRequests.toLocaleString()} / ${usage.limitRequests.toLocaleString()} (reset in ${usage.resetRequests})\n` +
          `• Session: ${usage.cumulativeTokens.toLocaleString()} tokens`,
        );
      },
    },
  ],
  tools: [
    {
      name: 'get_vps_status',
      description: 'Check current VPS server health, uptime, RAM memory usage, and disk space',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        const metrics = await getVpsMetrics();
        return JSON.stringify(metrics);
      },
    },
    {
      name: 'get_groq_usage',
      description: 'Check live Groq API rate limits, remaining tokens, token usage, quota, requests left, and rate limit reset timers for the active model',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        const usage = getGroqUsageStats();
        return JSON.stringify(usage);
      },
    },
    {
      name: 'get_available_models',
      description: 'List the active Groq models available on this account',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        const models = await getActiveGroqModels();
        return JSON.stringify(models);
      },
    },
  ],
};
