// Plugin registry — this is the only file you touch to add or remove plugins.
//
// HOW TO ADD YOUR OWN PLUGIN:
//   Run: npm run plugin:new <name>
//   Then import it here and add it to the array below.
//
// HOW TO INSTALL AN NPM PLUGIN:
//   Run: npm install mevaplus-plugin-weather
//   Then: import { weatherPlugin } from 'mevaplus-plugin-weather';
//   And add weatherPlugin to the array below.
//
// ORDER MATTERS: chatPlugin must always be last — it's the catch-all handler.

import { clearPlugin }    from './clear/index.js';
import { statusPlugin }   from './status/index.js';
import { chatPlugin }     from './chat/index.js';
import type { Plugin }    from '../types/plugin.js';

export const plugins: Plugin[] = [
  clearPlugin,
  statusPlugin,
  // your custom plugins go here ↑
  chatPlugin, // keep last
];
