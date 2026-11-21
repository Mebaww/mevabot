// Telegram-safe HTML formatter.
// Converts standard LLM Markdown into clean Telegram HTML entities
// with tap-to-copy code blocks, inline code, bold, quotes, and links.

import type { Context } from 'grammy';
import { logger }        from './logger.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts standard Markdown to Telegram-compliant HTML.
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return '';

  // Step 1: Extract and preserve multiline code blocks (```lang ... ```)
  const codeBlocks: string[] = [];
  let s = markdown.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code.trim());
    const langAttr = lang ? ` class="language-${lang.trim()}"` : '';
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return `\uE001${codeBlocks.length - 1}\uE001`;
  });

  // Step 2: Extract and preserve inline code (`code`) -> 1-tap copy in Telegram!
  const inlineCodes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE002${inlineCodes.length - 1}\uE002`;
  });

  // Step 3: Preserve existing valid Telegram HTML tags (if already formatted in HTML)
  const preservedHtmlTags: string[] = [];
  const telegramTagPattern = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler|span)(?:\s+[^>]*?)?>|<a(?:\s+[^>]*?)?>|<\/a>/gi;
  s = s.replace(telegramTagPattern, (tag) => {
    preservedHtmlTags.push(tag);
    return `\uE003${preservedHtmlTags.length - 1}\uE003`;
  });

  // Step 4: Escape HTML entities in surrounding text
  s = escapeHtml(s);

  // Step 5: Convert blockquotes (escaped as &gt;)
  s = s.replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');

  // Step 6: Convert Markdown headers (# Title, ## Subtitle) to bold headers
  s = s.replace(/^(#{1,6})\s+(.+)$/gm, '<b>$2</b>');

  // Step 7: Convert **bold** and __bold__
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/__(.+?)__/g, '<b>$1</b>');

  // Step 8: Convert *italic* and _italic_ (avoiding mid-word underscores like some_var_name)
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*([\s)]|$)/g, '$1<i>$2</i>$3');
  s = s.replace(/(^|[\s(])_([^_|\n]+)_([\s)]|$)/g, '$1<i>$2</i>$3');

  // Step 9: Convert strikethrough ~~text~~
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Step 10: Convert Markdown links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // Step 11: Restore code blocks, inline code, and preserved HTML tags
  s = s.replace(/\uE001(\d+)\uE001/g, (_, i) => codeBlocks[parseInt(i, 10)]);
  s = s.replace(/\uE002(\d+)\uE002/g, (_, i) => inlineCodes[parseInt(i, 10)]);
  s = s.replace(/\uE003(\d+)\uE003/g, (_, i) => preservedHtmlTags[parseInt(i, 10)]);

  return s.trim();
}

/**
 * Sends a message using Telegram HTML formatting.
 * If Telegram rejects the formatting (e.g. malformed tag), it automatically
 * falls back to plain text so the message NEVER fails to deliver.
 */
export async function replySafe(ctx: Context, text: string): Promise<void> {
  const formatted = markdownToTelegramHtml(text);

  try {
    await ctx.reply(formatted, { parse_mode: 'HTML' });
  } catch (err: unknown) {
    logger.warn('HTML parse failed, falling back to plain text', {
      error: (err as Error).message,
    });
    // Fallback: send raw plain text
    await ctx.reply(text);
  }
}
