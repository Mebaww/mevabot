// Scaffolds a new plugin at src/plugins/<name>/index.ts
// Usage: npm run plugin:new <name>
// Example: npm run plugin:new weather
// Note: Telegram command names must be lowercase letters, digits, or underscores (no hyphens).

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2]?.trim();

// Telegram command constraint: 1-32 chars, [a-z0-9_]
if (!name || !/^[a-z][a-z0-9_]{0,31}$/.test(name)) {
  console.error('Usage: npm run plugin:new <name>');
  console.error('Name must be lowercase alphanumeric with underscores (1-32 chars, no hyphens for Telegram command compatibility)');
  console.error('Examples: weather, crypto_price, remind_me');
  process.exit(1);
}

// Convert snake_case or kebab-case to camelCase for the export name
const exportName = name.replace(/[-_]([a-z0-9])/g, (_, c: string) => c.toUpperCase()) + 'Plugin';

const dir = join('src/plugins', name);

if (existsSync(dir)) {
  console.error(`Plugin "${name}" already exists at ${dir}`);
  process.exit(1);
}

mkdirSync(dir, { recursive: true });

const file = join(dir, 'index.ts');

writeFileSync(file, `import type { Plugin } from '../../types/plugin.js';

// TODO: import any services you need, e.g.:
// import { chat } from '../../services/groq.js';

export const ${exportName}: Plugin = {
  name: '${name}',

  // Add slash commands here, or remove this block if you don't need any.
  commands: [
    {
      command: '${name}',
      description: 'TODO: describe what this does',
      async handler(ctx) {
        await ctx.reply('Hello from ${name}!');
      },
    },
  ],

  // Uncomment to handle plain text messages (runs after all commands).
  // async onMessage(ctx) {
  //   await ctx.reply(\`You said: \${ctx.message.text}\`);
  // },
};
`);

console.log(`\nCreated ${file}`);
console.log(`\nNext: register it in src/plugins/index.ts`);
console.log(`  import { ${exportName} } from './${name}/index.js';`);
console.log(`  // add ${exportName} to the plugins array (before chatPlugin)`);
