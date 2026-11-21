# mevabot

A single-owner Telegram bot backed by [Groq](https://console.groq.com) for fast LLM inference.
Built with TypeScript and a plugin system that makes it easy to add, remove, or swap features.

## Features

- 💬 Conversational AI with persistent SQLite session memory (survives restarts)
- 🧠 Two-tier memory system: automatic long-term user facts & profile persistence
- ⏰ Reminders & alerts: `/remind`, `/reminders`, `/cancel_reminder` + autonomous AI scheduling
- 📊 Groq API usage: `/groq` real-time token quotas, rate limits, and reset countdowns
- 🖥️ VPS status: `/status` — RAM, Disk, Uptime
- 🔒 Owner-only: all messages from other users are silently dropped
- 🧩 Plugin system: add new commands and AI agentic tools by dropping a file

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5 (strict) |
| Runtime | Node.js 22 |
| Telegram | [grammY](https://grammy.dev) |
| LLM | [Groq SDK](https://console.groq.com) |

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/mebaww/mevabot.git
cd mevabot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
$EDITOR .env
```

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_USER_ID` | ✅ | Your numeric Telegram ID |
| `GROQ_API_KEY` | ✅ | From [console.groq.com](https://console.groq.com) |
| `GROQ_MODELS` | — | Comma-separated fallback list |
| `LOG_LEVEL` | — | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | — | Set to `production` on your VPS |

### 3. Run

```bash
npm run dev       # development — restarts on file changes (uses tsx)
npm run build     # compile TypeScript → dist/
npm start         # run compiled output
```

---

## Writing a plugin

```bash
npm run plugin:new my_feature
```

This creates `src/plugins/my_feature/index.ts` with the boilerplate ready. Fill in your logic, then register it in [`src/plugins/index.ts`](src/plugins/index.ts). Note: command names use `a-z`, `0-9`, and `_` (no hyphens, per Telegram command rules).

See [`src/plugins/_example/index.ts`](src/plugins/_example/index.ts) for a fully annotated reference.

### Plugin interface

```typescript
interface Plugin {
  name: string;
  commands?: BotCommand[];     // /slash commands (manual triggers)
  onMessage?: MessageHandler;  // plain-text catch-all
  tools?: ToolDefinition[];    // AI agentic tools (autonomous triggers)
}

interface BotCommand {
  command: string;             // without leading slash
  description: string;         // shown in Telegram picker
  handler: CommandHandler;
}

interface ToolDefinition {
  name: string;
  description: string;         // helps the AI decide when to call it
  parameters: {
    type: 'object';
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<string> | string;
}
```

### Installing an npm plugin

```bash
npm install mevaplus-plugin-weather
```

Then in `src/plugins/index.ts`:

```typescript
import { weatherPlugin } from 'mevaplus-plugin-weather';

export const plugins: Plugin[] = [
  // ...
  weatherPlugin,
  chatPlugin, // keep last
];
```

---

## Project layout

```
mevaplus/
├── index.ts                      Entry point — bot wiring
├── tsconfig.json
├── scripts/
│   └── new-plugin.ts             Plugin scaffolding script
└── src/
    ├── types/
    │   └── plugin.ts             Plugin, BotCommand, handler types
    ├── core/
    │   └── loader.ts             Registers plugins on the bot instance
    ├── config.ts                 Validated environment config
    ├── middleware/
    │   └── auth.ts               Owner-only gate
    ├── services/
    │   ├── db.ts                 Shared SQLite database connection (Node built-in)
    │   ├── groq.ts               Groq client + model fallback + agentic tools
    │   ├── history.ts            Per-user persistent conversation history
    │   ├── memory.ts             Long-term user memories & background fact extraction
    │   └── reminders.ts          Scheduled reminders & timer persistence (SQLite)
    ├── utils/
    │   ├── format.ts             Telegram-safe HTML formatter with 1-tap copy
    │   └── logger.ts             Structured logger (JSON in prod)
    └── plugins/
        ├── index.ts              ← Plugin registry (edit to add plugins)
        ├── _example/             Annotated reference plugin (not registered)
        ├── clear/                /clear command (resets active session)
        ├── memory/               /memories, /remember, /forget commands
        ├── status/               /status (VPS) and /groq (API limits) commands
        ├── remind/               /remind, /reminders, /cancel_reminder commands + scheduler
        └── chat/                 Plain-text message handler + tool execution
```

---

## VPS deployment (systemd)

```bash
# 1. Copy files to your server
rsync -av --exclude=node_modules --exclude=.env --exclude=dist --exclude=data . user@vps:/opt/mevabot/

# 2. On the server
cd /opt/mevabot
npm install
npm run build

# 3. Create a dedicated system user
sudo useradd -r -s /sbin/nologin mevabot
sudo chown -R mevabot:mevabot /opt/mevabot
sudo chmod 600 /opt/mevabot/.env

# 4. Install and enable the systemd unit
sudo cp mevabot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mevabot

# 5. Check logs
sudo journalctl -u mevabot -f
```

## Docker

```bash
docker build -t mevabot .
docker run -d --restart unless-stopped -v $(pwd)/data:/app/data --env-file .env --name mevabot mevabot
```

