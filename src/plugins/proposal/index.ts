// Upwork Proposal Generator Plugin.
// Injects `skills.md` into the Groq prompt so the model semantically infers
// the best matching skill profile and writes a complete tailored proposal following Meba's framework.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InlineKeyboard, type Context } from 'grammy';
import { chat, GroqChatError } from '../../services/groq.js';
import { formatMemoryContext } from '../../services/memory.js';
import { setPendingAction, clearPendingAction } from '../../services/userState.js';
import { replySafe, markdownToTelegramHtml } from '../../utils/format.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';
import type { CommandHandler, Plugin } from '../../types/plugin.js';

/**
 * Reads skills.md (or fallback skills.example.md) from the plugin directory or workspace.
 */
function getSkillsMarkdown(): string {
  // 1. Check data/ directory first (persisted on VPS across CI/CD deploys)
  const dataPath = path.resolve(process.cwd(), 'data/skills.md');
  if (fs.existsSync(dataPath)) {
    return fs.readFileSync(dataPath, 'utf-8').trim();
  }

  // 2. Check workspace paths
  const workspacePath = path.resolve(process.cwd(), 'src/plugins/proposal/skills.md');
  if (fs.existsSync(workspacePath)) {
    return fs.readFileSync(workspacePath, 'utf-8').trim();
  }

  const workspaceExample = path.resolve(process.cwd(), 'src/plugins/proposal/skills.example.md');
  if (fs.existsSync(workspaceExample)) {
    return fs.readFileSync(workspaceExample, 'utf-8').trim();
  }

  // 2. Check module relative paths
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const modulePath = path.resolve(currentDir, 'skills.md');
    if (fs.existsSync(modulePath)) {
      return fs.readFileSync(modulePath, 'utf-8').trim();
    }
    const moduleExample = path.resolve(currentDir, 'skills.example.md');
    if (fs.existsSync(moduleExample)) {
      return fs.readFileSync(moduleExample, 'utf-8').trim();
    }
  } catch {
    // Ignore URL resolution error in edge runtimes
  }

  return '';
}

/**
 * Parses user input to extract optional suggestions/ideas and the core job description.
 * Supports:
 * - [suggestion/ideas] job description
 * - Suggestion: ... \n Job: ...
 * - Job ... \n Suggestion: ...
 */
export function parseProposalInput(rawInput: string): { jobText: string; suggestion?: string } {
  // Pattern 1: [suggestion or ideas] <job description>
  const bracketMatch = rawInput.match(/^\[([^\]]+)\]\s*([\s\S]+)$/);
  if (bracketMatch) {
    return { suggestion: bracketMatch[1].trim(), jobText: bracketMatch[2].trim() };
  }

  // Pattern 2: Suggestion/Idea/Note: ... \n Job: ...
  const prefixMatch = rawInput.match(
    /^(?:suggestion|suggestions|idea|ideas|note|notes|hint|hints):\s*([\s\S]+?)\n+(?:job(?:\s+post|\s+description)?:\s*)?([\s\S]+)$/i,
  );
  if (prefixMatch) {
    return { suggestion: prefixMatch[1].trim(), jobText: prefixMatch[2].trim() };
  }

  // Pattern 3: Job ... \n Suggestion/Idea/Note: ...
  const suffixMatch = rawInput.match(
    /^([\s\S]+?)\n+(?:---\n+)?(?:suggestion|suggestions|idea|ideas|note|notes|hint|hints):\s*([\s\S]+)$/i,
  );
  if (suffixMatch) {
    return { suggestion: suffixMatch[2].trim(), jobText: suffixMatch[1].trim() };
  }

  return { jobText: rawInput.trim() };
}

/**
 * Splits YAML frontmatter (name/version/description) from the Markdown body.
 * Skill files can either be a plain framework document or frontmatter + body.
 */
function splitSkillsDoc(doc: string): { frontmatter: Record<string, string>; body: string } {
  const match = doc.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {}, body: doc };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!entry) continue;
    let value = entry[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[entry[1].toLowerCase()] = value;
  }

  return { frontmatter, body: doc.slice(match[0].length) };
}

/**
 * Extracts developer name and title from the loaded skills document or defaults to generic placeholders.
 */
function extractDeveloperProfile(doc: string): { name: string; title?: string } {
  const { body } = splitSkillsDoc(doc);
  const nameMatch = body.match(/^\s*(?:-\s*)?Name:\s*([^(\n]+)/im);
  const titleMatch = body.match(/^\s*(?:-\s*)?(?:Profile\s+)?Title:\s*([^\n]+)/im);
  return {
    name: nameMatch ? nameMatch[1].trim() : 'the developer',
    title: titleMatch ? titleMatch[1].trim() : undefined,
  };
}

export interface ProposalSkillsOverview {
  name?: string;
  title?: string;
  version?: string;
  projects: string[];
  hookTypes: Array<{ key: string; label: string }>;
  pipeline: string[];
}

const TITLE_ACRONYMS = new Set([
  'ai',
  'api',
  'cms',
  'cta',
  'faq',
  'mvp',
  'saas',
  'seo',
  'ui',
  'ux',
  'vsl',
]);

const TITLE_SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (TITLE_ACRONYMS.has(lower)) return word.toUpperCase();
      if (TITLE_SMALL_WORDS.has(lower) && index > 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Extracts the high-level structure of skills.md (profile, version, portfolio
 * projects, hook types, and pipeline stages) so the bot can show a compact
 * overview instead of dumping the entire framework document into chat.
 */
export function parseSkillsOverview(doc: string): ProposalSkillsOverview {
  const { frontmatter, body } = splitSkillsDoc(doc);
  const profile = extractDeveloperProfile(doc);

  // Prefer YAML frontmatter (`version: "2.5"`), fall back to a heading like `(v2.4 - Streamlined)`.
  const frontmatterVersion = frontmatter.version?.trim().replace(/^v/i, '');
  const headingMatch = (body.match(/^#\s+(.+)$/m)?.[1] ?? '').match(
    /\(v?(\d+(?:\.\d+)*)(?:\s*[-–—]\s*([^)]+))?\)/i,
  );
  const version = frontmatterVersion
    ? `v${frontmatterVersion}`
    : headingMatch
      ? `v${headingMatch[1]}${headingMatch[2] ? ` — ${headingMatch[2].trim()}` : ''}`
      : undefined;

  const projects = [...body.matchAll(/^\s*PROJECT\s+\d+\s*:\s*(.+?)\s*$/gm)].map((m) => m[1]);

  const hookTypes: Array<{ key: string; label: string }> = [];
  const seenHooks = new Set<string>();
  for (const match of body.matchAll(/^\s*(?:[-*]\s*)?TYPE\s+([A-Z])\s*\(([^)]*)\)/gim)) {
    if (seenHooks.has(match[1])) continue;
    seenHooks.add(match[1]);
    hookTypes.push({ key: match[1], label: match[2].trim() });
  }
  hookTypes.sort((a, b) => a.key.localeCompare(b.key));

  const pipeline = [
    ...body.matchAll(/^\s*#{2,4}\s*(?:Section|Step)\s+(\d+[A-Za-z]?)\s*:\s*(.+?)\s*$/gim),
  ].map((m) => `${m[1]}. ${titleCase(m[2].replace(/\s*\(.*$/, '').trim())}`);

  return { ...profile, version, projects, hookTypes, pipeline };
}

/**
 * Builds the compact /upwork_skill overview message.
 */
export function formatSkillsOverview(doc: string): string {
  const overview = parseSkillsOverview(doc);
  const lines: string[] = [];

  const versionSuffix = overview.version ? ` ${overview.version}` : '';
  lines.push(`**Upwork Skill${versionSuffix}**`);
  if (overview.name) lines.push(overview.name);
  if (overview.title) lines.push(overview.title);
  lines.push('');

  lines.push('One skill, matched to each job. Pipeline:');
  if (overview.pipeline.length) {
    for (const stage of overview.pipeline) lines.push(stage);
  } else {
    lines.push('• Hook → Proof → Scope → Breath → CTA');
  }
  lines.push('');

  if (overview.projects.length) {
    lines.push(`**Portfolio proof — pick 1 of ${overview.projects.length}**`);
    for (const project of overview.projects) lines.push(`• ${project}`);
    lines.push('');
  }

  if (overview.hookTypes.length) {
    lines.push(`**Hook types — auto-matched (${overview.hookTypes.length})**`);
    for (const hook of overview.hookTypes) lines.push(`• ${hook.key} — ${hook.label}`);
    lines.push('');
  }

  lines.push('Use `/proposal [suggestion] <job post>` to write one.');
  lines.push('Send `/upwork_skill full` for the complete framework.');

  return lines.join('\n');
}

async function sendSkillsOverview(ctx: Context): Promise<void> {
  const doc = getSkillsMarkdown();
  if (!doc) {
    await replySafe(ctx, 'No `skills.md` file found.');
    return;
  }

  await replySafe(ctx, formatSkillsOverview(doc));
}

/** Compact skill version (e.g. "v2.4") for the Telegram command menu. */
const skillVersion = parseSkillsOverview(getSkillsMarkdown()).version?.split(' — ')[0];

/** `/upwork_skill` — compact skill overview. */
const proposalSkillsHandler: CommandHandler = async (ctx) => {
  if (/^(?:full|raw)$/i.test(ctx.match?.trim() ?? '')) {
    const doc = getSkillsMarkdown();
    await replySafe(ctx, doc || 'No `skills.md` file found.');
    return;
  }
  await sendSkillsOverview(ctx);
};

export interface GenerateProposalOptions {
  jobText: string;
  userId?: number;
  suggestion?: string;
  skillHint?: string; // backward compat
}

/**
 * Generates an Upwork proposal by executing the assembly pipeline in `skills.md`.
 */
export async function generateProposal(opts: GenerateProposalOptions): Promise<string> {
  const { jobText, userId } = opts;
  const suggestion = (opts.suggestion || opts.skillHint)?.trim();

  const skillsDoc = getSkillsMarkdown();
  const memoryContext = userId ? formatMemoryContext(userId) : '';
  const customProfile = process.env.PROPOSAL_PROFILE?.trim();

  const devProfile = extractDeveloperProfile(skillsDoc);
  const devName = process.env.DEVELOPER_NAME?.trim() || devProfile.name;
  const roleDesc = devProfile.title ? `, a ${devProfile.title}` : '';

  const systemPrompt = `You are a proposal writer for ${devName}${roleDesc} on Upwork.
Your only job is to produce a finished, copy-paste-ready Upwork proposal — nothing else.

HARD RULES:
- Output ONLY the proposal. Zero preamble, analysis, commentary, or sign-offs before or after.
- Start the very first character of your output with the first character of the hook line.
- Write with natural sentence flow. Each sentence should lead into the next — not feel like a list of fragments.
- Follow the pipeline, formatting rules, and tone examples in the Framework document exactly.
- If ${devName} provides personal suggestions, directions, or ideas (for the hook, portfolio, approach, tone, or CTA), prioritize and weave them directly into the proposal alongside profile facts.`;

  const prompt = [
    skillsDoc ? `FRAMEWORK DOCUMENT (read carefully — follow every rule and pipeline step):\n"""\n${skillsDoc}\n"""\n` : '',
    customProfile ? `Additional Profile Context:\n${customProfile}\n` : '',
    memoryContext ? `Stored Facts About ${devName}:\n${memoryContext}\n` : '',
    'CLIENT JOB POST:',
    '"""',
    jobText,
    '"""',
    '',
    suggestion
      ? [
          `${devName.toUpperCase()}'S PERSONAL SUGGESTIONS & DIRECTIVES:`,
          `"""`,
          suggestion,
          `"""`,
          `IMPORTANT: Actively incorporate ${devName}'s suggestions above (e.g. specific hook angle, portfolio selection, scope focus, tone nuances, or closing CTA question) while maintaining the authentic peer tone and 5-section framework from skills.md. Blend ${devName}'s ideas seamlessly into the finished proposal.`,
          '',
        ].join('\n')
      : '',
    'Write the proposal now. Start with the hook — no labels, no preamble, no markdown:',
  ].filter(Boolean).join('\n');

  const reply = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 1000, temperature: 0.65 },
  );

  return reply.trim().replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '').trim();
}

export const proposalPlugin: Plugin = {
  name: 'proposal',
  init(bot) {
    // 1-Tap "Cancel" action from interactive proposal prompt
    bot.callbackQuery('proposal_cancel_to_menu', async (ctx) => {
      clearPendingAction(ctx.from.id);
      await ctx.answerCallbackQuery({ text: 'Cancelled' });
      await ctx.editMessageText(
        markdownToTelegramHtml('Action cancelled.\n\nType /help to see available commands or send a message to chat.'),
        { parse_mode: 'HTML' },
      ).catch(() => {});
    });

    // 1-Tap "Skills" action from proposal prompt
    bot.callbackQuery('proposal_show_skills', async (ctx) => {
      await ctx.answerCallbackQuery();
      await sendSkillsOverview(ctx);
    });
  },
  commands: [
    {
      command: 'proposal',
      description: 'Write an Upwork proposal (/proposal [suggestion] <job>)',
      async handler(ctx) {
        const userId = ctx.from?.id;
        const rawInput = ctx.match?.trim();

        if (!rawInput) {
          if (userId) {
            setPendingAction(userId, { type: 'awaiting_proposal' });
          }

          const keyboard = new InlineKeyboard()
            .text('❌ Cancel / Main Menu', 'proposal_cancel_to_menu')
            .text('📜 Skills', 'proposal_show_skills');

          await ctx.reply(
            markdownToTelegramHtml(
              '📋 **Upwork Proposal**\n\n' +
              'Please paste the client\'s job post or description below.\n\n' +
              '_Tip: You can also include custom ideas, hook suggestions, or CTA directions in brackets like `[focus on 6h turnaround]` or `Suggestion: ...`._'
            ),
            {
              parse_mode: 'HTML',
              reply_markup: keyboard,
            },
          );
          return;
        }

        const skillsMatch = rawInput.match(/^(?:skills|list)(?:\s+(full|raw))?$/i);
        if (skillsMatch) {
          if (skillsMatch[1]) {
            const doc = getSkillsMarkdown();
            await replySafe(ctx, doc || 'No `skills.md` found.');
          } else {
            await sendSkillsOverview(ctx);
          }
          return;
        }

        const { jobText, suggestion } = parseProposalInput(rawInput);

        await ctx.replyWithChatAction('typing');

        try {
          const proposal = await generateProposal({
            jobText,
            userId: ctx.from?.id,
            suggestion,
          });

          await replySafe(ctx, `\`\`\`\n${proposal}\n\`\`\``);
        } catch (err: unknown) {
          logger.error('Proposal generation failed', { message: (err as Error).message });
          await ctx.reply(
            err instanceof GroqChatError && err.rateLimited
              ? 'Groq is rate-limiting proposal generation right now. Give it about 30 seconds and try again.'
              : 'Could not generate a proposal right now. Try again in a moment.',
          );
        }
      },
    },
    {
      command: 'upwork_skill',
      description: `Upwork skill overview${skillVersion ? ` (${skillVersion})` : ''}`,
      handler: proposalSkillsHandler,
    },
  ],
  tools: [
    {
      name: 'generate_upwork_proposal',
      description:
        'Generates an Upwork proposal following the framework in skills.md, actively incorporating any suggestions, hook ideas, or CTA directions from the developer.',
      parameters: {
        type: 'object',
        properties: {
          job_description: {
            type: 'string',
            description: 'The client job post or project description',
          },
          suggestion: {
            type: 'string',
            description:
              'Optional suggestions, ideas, or directives from the developer (e.g., custom hook idea, portfolio project to highlight, scope priorities, or preferred CTA question)',
          },
          skill_hint: {
            type: 'string',
            description: 'Deprecated alias for suggestion',
          },
        },
        required: ['job_description'],
      },
      async execute(args) {
        const jobText = String(args.job_description || '').trim();
        if (!jobText) {
          return JSON.stringify({ error: 'Missing job_description' });
        }

        const suggestion = String(args.suggestion || args.skill_hint || '').trim();

        const proposal = await generateProposal({
          jobText,
          userId: config.telegram.ownerId,
          suggestion: suggestion || undefined,
        });

        return proposal;
      },
    },
  ],
};
