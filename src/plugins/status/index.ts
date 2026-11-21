import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import type { Plugin } from '../../types/plugin.js';

const exec = promisify(execFile);

// 5 s timeout so a hung binary doesn't freeze the bot
async function run(bin: string, args: string[]): Promise<string> {
  const { stdout } = await exec(bin, args, { timeout: 5000 });
  return stdout.trim();
}

export const statusPlugin: Plugin = {
  name: 'status',
  commands: [
    {
      command: 'status',
      description: 'Show VPS stats',
      async handler(ctx) {
        try {
          const [uptime, freeOut, dfOut] = await Promise.all([
            run('uptime', ['-p']),
            run('free', ['-h']),
            run('df', ['-h', '/']),
          ]);

          // free -h: "Mem:  <total>  <used>  <free> ..."
          const mem  = freeOut.split('\n').find((l) => l.startsWith('Mem:'))?.split(/\s+/) ?? [];
          // df -h /: "<fs>  <size>  <used>  <avail>  <use%>  <mount>"
          const disk = dfOut.split('\n').find((l) => l.includes('/'))?.split(/\s+/) ?? [];

          await ctx.reply(
            `*VPS Status*\n\n` +
            `⏱ Uptime: \`${uptime}\`\n` +
            `🧠 RAM:   \`${mem[2] ?? '?'} / ${mem[1] ?? '?'}\`\n` +
            `💾 Disk:  \`${disk[2] ?? '?'} / ${disk[1] ?? '?'} (${disk[4] ?? '?'} used)\``,
            { parse_mode: 'Markdown' },
          );
        } catch (err: unknown) {
          logger.error('Status failed', { message: (err as Error).message });
          await ctx.reply('Could not read system stats. Check the logs.');
        }
      },
    },
  ],
};
