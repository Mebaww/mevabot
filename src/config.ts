// Crash early if a required env var is missing or empty.
function need(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) {
    console.error(`[config] ${name} is required but not set`);
    process.exit(1);
  }
  return val;
}

function needInt(name: string): number {
  const val = need(name);
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) {
    console.error(`[config] ${name} must be a positive integer, got "${val}"`);
    process.exit(1);
  }
  return n;
}

export const config = {
  telegram: {
    token: need('TELEGRAM_BOT_TOKEN'),
    ownerId: needInt('TELEGRAM_USER_ID'),
  },
  groq: {
    apiKey: need('GROQ_API_KEY'),
    // Each model is tried in order — first one that works wins.
    // Set GROQ_MODELS=model-a,model-b to override.
    models: process.env.GROQ_MODELS
      ? process.env.GROQ_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
      : [
          'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'openai/gpt-oss-120b',
          'openai/gpt-oss-20b',
        ],
  },
  chat: {
    // How many messages (user + assistant combined) to keep per session.
    maxMessages: 16,
  },
} as const;

export type Config = typeof config;
