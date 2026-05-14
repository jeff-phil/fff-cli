/**
 * Resolve @ff-labs/fff-node import path dynamically.
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);

function getNpmGlobalPrefix() {
  try { return execSync('npm config get prefix', { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch { return null; }
}

export async function resolveFffNode() {
  // 1. Environment variable override
  if (process.env.FFF_FFF_NODE_PATH) {
    try { return await import(process.env.FFF_FFF_NODE_PATH); }
    catch (e) {
      throw new Error(`FFF_FFF_NODE_PATH set but failed to import: ${e.message}`);
    }
  }

  // 2. Direct dependency via standard resolution
  try { return await import('@ff-labs/fff-node'); }
  catch {}

  // 3. Through @ff-labs/pi-fff (standard resolution)
  try {
    const piFffPath = require.resolve('@ff-labs/pi-fff/package.json');
    return await import(piFffPath.replace(/package\.json$/, 'node_modules/@ff-labs/fff-node/dist/src/index.js'));
  } catch {}

  // 4. npm global prefix
  const npmPrefix = getNpmGlobalPrefix();
  if (npmPrefix) {
    try { return await import(path.join(npmPrefix, 'lib/node_modules/@ff-labs/fff-node/dist/src/index.js')); }
    catch {}
    try { return await import(path.join(npmPrefix, 'lib/node_modules/@ff-labs/pi-fff/node_modules/@ff-labs/fff-node/dist/src/index.js')); }
    catch {}
  }

  // 5. Common global paths
  const globalPaths = [
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    path.join(homedir(), '.npm-global/lib/node_modules'),
    path.join(homedir(), '.config/yarn/global/node_modules'),
    path.join(homedir(), '.pnpm-global/node_modules'),
    '/opt/node_modules',
    '/opt/homebrew/lib/node_modules',
  ];

  for (const gp of globalPaths) {
    try { return await import(path.join(gp, '@ff-labs/fff-node/dist/src/index.js')); }
    catch {}
    try { return await import(path.join(gp, '@ff-labs/pi-fff/node_modules/@ff-labs/fff-node/dist/src/index.js')); }
    catch {}
  }

  throw new Error(
    `Could not find @ff-labs/fff-node.\n\n` +
    `Install it:\n` +
    `  npm install -g @ff-labs/fff-node\n` +
    `  npm install -g @ff-labs/pi-fff\n` +
    `\nOr set the environment variable:\n` +
    `  export FFF_FFF_NODE_PATH=/path/to/@ff-labs/fff-node/dist/src/index.js`
  );
}
