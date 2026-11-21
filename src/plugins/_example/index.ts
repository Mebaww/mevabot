// This is a reference plugin showing everything the plugin API supports.
// It is NOT registered in src/plugins/index.ts — it's here to copy from.
//
// To use it: copy this folder, rename it, and add it to the registry.

import type { Plugin } from '../../types/plugin.js';

// If you need the AI, import chat. If you need memory, import history.
// import { chat } from '../../services/groq.js';
// import { addMessage, getHistory } from '../../services/history.js';

export const examplePlugin: Plugin = {
  // name shows up in log output — keep it short and unique
  name: 'example',

  // Each entry here becomes a /command the bot understands.
  // You can have as many commands as you want in one plugin.
  commands: [
    {
      command: 'hello',
      description: 'Say hello back',

      // ctx.match is whatever the user typed after /hello
      // e.g. "/hello world" → ctx.match === "world"
      async handler(ctx) {
        const name = ctx.match?.trim() || ctx.from?.first_name || 'there';
        await ctx.reply(`Hey ${name}!`);
      },
    },

    {
      command: 'flip',
      description: 'Flip a coin',
      async handler(ctx) {
        await ctx.reply(Math.random() < 0.5 ? 'Heads' : 'Tails');
      },
    },
  ],

  // onMessage runs for every plain text message that isn't a command.
  // Only add this if your plugin actually needs to intercept messages.
  // If multiple plugins define onMessage, they all run in registry order —
  // so make sure only one of them actually sends a reply.
  //
  // async onMessage(ctx) {
  //   const text = ctx.message.text;
  //   await ctx.reply(`You said: ${text}`);
  // },
};
