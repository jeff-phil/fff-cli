#!/usr/bin/env node
/**
 * fff-daemon — long-running FFF indexer + IPC server.
 *
 * Usage (server):
 *   fff-daemon [directory] [options]
 *
 * Usage (client control):
 *   fff-daemon scan
 *   fff-daemon health
 *   fff-daemon shutdown
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { resolveFffNode } from './resolve-fff.mjs';

const { FileFinder } = await resolveFffNode();
const NAME = path.basename(process.argv[1] || 'fff-daemon.mjs');

const SOCK_PATH = process.env.FFF_DAEMON_SOCK || '/tmp/fff.sock';
const CONTROL_OPS = new Set(['scan', 'health', 'shutdown', 'watch-on', 'watch-off']);

// ---------------------------------------------------------------------------
// Control command client (scan / health / shutdown)
// ---------------------------------------------------------------------------

function sendControl(op, sockPath) {
  const connectPath = sockPath || SOCK_PATH;
  return new Promise((resolve, reject) => {
    const sock = net.connect({ path: connectPath });
    let buf = '';
    let done = false;

    function finish(err, result) {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      if (err) reject(err); else resolve(result);
    }

    sock.setEncoding('utf8');
    sock.setTimeout(10000);

    sock.on('connect', () => {
      sock.write(JSON.stringify({ op, params: {} }) + '\n');
    });

    sock.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        try {
          const response = JSON.parse(buf.slice(0, nl));
          if (!response.ok) finish(new Error(response.error || 'daemon error'));
          else finish(null, response.result);
        } catch (e) {
          finish(new Error(`Invalid daemon response: ${e.message}`));
        }
      }
    });

    sock.on('error', (e) => finish(e));
    sock.on('timeout', () => finish(new Error('Daemon timeout')));
    sock.on('close', () => {
      if (!done) finish(new Error('Daemon closed without response'));
    });
  });
}

async function runControl(op, sockPath) {
  try {
    const result = await sendControl(op, sockPath);
    if (op === 'shutdown') {
      console.log('✅ Daemon signaled to shut down.');
    } else if (op === 'scan') {
      console.log('✅ Scan triggered.');
      if (result) console.log(JSON.stringify(result, null, 2));
    } else if (op === 'watch-on') {
      console.log(result.message || 'Watch enabled.');
    } else if (op === 'watch-off') {
      console.log(result.message || 'Watch disabled.');
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  } catch (e) {
    console.error(`Cannot reach daemon at ${sockPath || SOCK_PATH}: ${e.message}`);
    console.error('Is the daemon running? Start it with: fff-daemon [directory]');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function showHelp(exitCode = 0) {
  const sink = exitCode === 0 ? console.log : console.error;
  sink(`Usage: ${NAME} [directory|command] [options]`);
  sink();
  sink('Server mode:');
  sink(`  ${NAME}               Start daemon for current directory`);
  sink(`  ${NAME} ~/my-project  Start daemon for specific directory`);
  sink();
  sink('Client control:');
  sink(`  ${NAME} scan          Trigger a rescan in the running daemon`);
  sink(`  ${NAME} health        Show daemon status`);
  sink(`  ${NAME} watch-on      Start watching for file changes`);
  sink(`  ${NAME} watch-off     Stop watching for file changes`);
  sink(`  ${NAME} shutdown      Stop the running daemon`);
  sink();
  sink('Options:');
  sink('  --frecency-db <path>     Frecency DB');
  sink('  --history-db <path>      History DB');
  sink('  --sock <path>            Unix socket path (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)');
  sink('  --watch                  Watch base directory for changes and auto-rescan');
  sink('  --help                   Show this message');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {
    directory: undefined,
    frecencyDbPath: undefined,
    historyDbPath: undefined,
    sockPath: SOCK_PATH,
    watch: false,
    controlOp: undefined,
  };
  const remaining = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help': showHelp(); break;
      case '--frecency-db': result.frecencyDbPath = argv[++i]; break;
      case '--history-db': result.historyDbPath = argv[++i]; break;
      case '--sock': result.sockPath = argv[++i]; break;
      case '--watch': result.watch = true; break;
      default:
        if (arg.startsWith('-')) { console.error(`${NAME}: unknown option: ${arg}`); process.exit(1); }
        remaining.push(arg);
    }
  }
  if (remaining.length > 0) {
    const first = remaining[0];
    if (CONTROL_OPS.has(first)) {
      result.controlOp = first;
    } else {
      result.directory = first;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

// Dispatch control commands before touching server logic
if (args.controlOp) {
  await runControl(args.controlOp, args.sockPath);
  // runControl exits; we never get here
}

// ---------------------------------------------------------------------------
// Server mode below
// ---------------------------------------------------------------------------

// Check if another daemon is already listening on the socket
const alreadyRunning = await new Promise((resolve) => {
  const testSock = net.connect({ path: args.sockPath });
  testSock.on('connect', () => { testSock.destroy(); resolve(true); });
  testSock.on('error', () => { testSock.destroy(); resolve(false); });
  testSock.setTimeout(200, () => { try { testSock.destroy(); } catch {} resolve(false); });
});

if (alreadyRunning) {
  console.error(`❌ A daemon is already running on socket ${args.sockPath}`);
  console.error('   Use a different --sock or stop the existing daemon first.');
  process.exit(1);
}

// Clean up a stale socket file (no daemon listening)
try { fs.unlinkSync(args.sockPath); } catch {}

// ---------------------------------------------------------------------------
// DB path resolution
// ---------------------------------------------------------------------------

function resolveDbPaths(basePath) {
  let frecencyDbPath = process.env.FFF_FRECENCY_DB ?? undefined;
  let historyDbPath = process.env.FFF_HISTORY_DB ?? undefined;

  if (!frecencyDbPath) {
    const autoBase = path.join(basePath, '.local/share/fff/frecency');
    try { if (fs.statSync(autoBase).isDirectory()) frecencyDbPath = autoBase; } catch {}
  }
  if (!frecencyDbPath) {
    const autoHome = path.join(homedir(), '.local/share/fff/frecency');
    try { if (fs.statSync(autoHome).isDirectory()) frecencyDbPath = autoHome; } catch {}
  }
  if (!historyDbPath) {
    const autoBase = path.join(basePath, '.local/share/fff/history');
    try { if (fs.statSync(autoBase).isDirectory()) historyDbPath = autoBase; } catch {}
  }
  if (!historyDbPath) {
    const autoHome = path.join(homedir(), '.local/share/fff/history');
    try { if (fs.statSync(autoHome).isDirectory()) historyDbPath = autoHome; } catch {}
  }
  return { frecencyDbPath, historyDbPath };
}

// ---------------------------------------------------------------------------
// Git info
// ---------------------------------------------------------------------------

function getGitInfo(dir) {
  try {
    const topLevel = execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf8', timeout: 5000 }).trim();
    const workdir = execSync('git worktree list --porcelain', { cwd: dir, encoding: 'utf8', timeout: 5000 })
      .split('\n')
      .find(l => l.startsWith('worktree '))
      ?.replace('worktree ', '')
      ?? topLevel;
    return { repositoryFound: true, workdir };
  } catch {
    return { repositoryFound: false };
  }
}

// ---------------------------------------------------------------------------
// Create FileFinder
// ---------------------------------------------------------------------------

const directory = args.directory || process.cwd();
console.log(`→ Creating FileFinder for: ${directory}`);
const { frecencyDbPath, historyDbPath } = resolveDbPaths(directory);
const finderResult = FileFinder.create({
  basePath: directory,
  aiMode: true,
  frecencyDbPath: args.frecencyDbPath ?? frecencyDbPath,
  historyDbPath: args.historyDbPath ?? historyDbPath,
});
if (!finderResult.ok) {
  console.error('Failed to create FileFinder:', finderResult.error);
  process.exit(1);
}
const finder = finderResult.value;

console.log('→ Waiting for initial scan...');
const scanDone = await finder.waitForScan(60000);
if (!scanDone.ok || !scanDone.value) {
  console.warn('⚠️  Scan timeout; daemon is running with partial index.');
}

const progress = finder.getScanProgress();
const fileCount = progress.ok ? progress.value.scannedFilesCount : '?';
console.log(`  Indexed ${fileCount} files${progress.ok && progress.value.isScanning ? ' (scanning...)' : ''}`);

const dbInfo = [];
if (args.frecencyDbPath ?? frecencyDbPath) dbInfo.push('frecency');
if (args.historyDbPath ?? historyDbPath) dbInfo.push('history');
if (dbInfo.length > 0) console.log(`  Using DBs: ${dbInfo.join(', ')}`);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function reconstructCursor(raw) {
  if (!raw || raw._offset === undefined) return null;
  return { __brand: 'GrepCursor', _offset: raw._offset };
}

function serialiseResult(result) {
  return JSON.parse(JSON.stringify(result, (_key, val) => {
    if (val && typeof val === 'object' && val.constructor && val.constructor.name === 'Buffer') {
      return val.toString('utf8');
    }
    return val;
  }));
}

const handlers = {
  async find({ query, pageIndex = 0, pageSize = 30 }) {
    const r = finder.fileSearch(query, { pageIndex, pageSize });
    if (!r.ok) throw new Error(r.error);
    return serialiseResult(r.value);
  },

  async grep({ query, mode = 'plain', smartCase = true, maxMatchesPerFile = 50, cursorRaw = null, beforeContext = 0, afterContext = 0 }) {
    const r = finder.grep(query, {
      mode,
      smartCase,
      maxMatchesPerFile,
      cursor: reconstructCursor(cursorRaw),
      beforeContext,
      afterContext,
      classifyDefinitions: true,
    });
    if (!r.ok) throw new Error(r.error);
    return serialiseResult(r.value);
  },

  async 'multi-grep'({ patterns, constraints = null, maxMatchesPerFile = 50, smartCase = true, cursorRaw = null, beforeContext = 0, afterContext = 0 }) {
    const r = finder.multiGrep({
      patterns,
      constraints,
      maxMatchesPerFile,
      smartCase,
      cursor: reconstructCursor(cursorRaw),
      beforeContext,
      afterContext,
      classifyDefinitions: true,
    });
    if (!r.ok) throw new Error(r.error);
    return serialiseResult(r.value);
  },

  async scan() {
    if (finder.isScanning()) return { message: 'Scan already in progress.' };
    finder.scanFiles();
    return { message: 'Scan triggered.' };
  },

  async health() {
    const progress = finder.getScanProgress();
    const git = getGitInfo(directory);
    return {
      basePath: directory,
      scannedFilesCount: progress.ok ? progress.value.scannedFilesCount : null,
      scanning: progress.ok ? progress.value.isScanning : null,
      git: git.repositoryFound ? `yes (${git.workdir})` : 'no',
      watching: watcher !== null,
      dbs: dbInfo.length ? dbInfo : 'No frecency or history dbs configured',
      sockPath: args.sockPath,
    };
  },

  async 'watch-on'() {
    if (watcher) return { message: 'Watch already enabled.' };
    startWatcher(directory);
    return { message: 'Watch enabled.' };
  },

  async 'watch-off'() {
    if (!watcher) return { message: 'Watch already disabled.' };
    stopWatcher();
    return { message: 'Watch disabled.' };
  },

  async shutdown() {
    setTimeout(() => shutdownServer(), 50);
    return { message: 'Shutting down...' };
  },
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let activeConnections = 0;

function writeResponse(socket, payload) {
  socket.write(JSON.stringify(payload) + '\n');
}

const server = net.createServer((socket) => {
  activeConnections++;
  let buffer = '';

  socket.setEncoding('utf8');

  socket.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);

      if (!line) continue;

      (async () => {
        try {
          const req = JSON.parse(line);
          console.log(`[${new Date().toISOString()}] op=${req.op} > ${JSON.stringify(req.params || {})}`);
          const handler = handlers[req.op];
          if (!handler) {
            writeResponse(socket, { ok: false, error: `Unknown op: ${req.op}` });
            return;
          }
          const result = await handler(req.params || {});
          writeResponse(socket, { ok: true, result });
        } catch (err) {
          writeResponse(socket, { ok: false, error: err.message });
        }
      })();
    }
  });

  socket.on('error', () => {});
  socket.on('close', () => { activeConnections--; });
});

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

let watcher = null;
let debounceTimer = null;
const WATCH_DEBOUNCE_MS = 500;

function loadIgnorePatterns(basePath) {
  const basenames = new Set();
  const exts = new Set();

  let dir = basePath;
  while (true) {
    for (const name of ['.gitignore', '.ignore']) {
      try {
        const content = fs.readFileSync(path.join(dir, name), 'utf8');
        for (const raw of content.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line || line.startsWith('#') || line.startsWith('!')) continue;
          const pat = line.endsWith('/') ? line.slice(0, -1) : line;

          if (pat.startsWith('*.')) {
            exts.add(pat.slice(1));
          } else if (/[?*[{\]]/.test(pat) || pat.includes('/')) {
            // Skip glob/path patterns — too easy to get wrong
            continue;
          } else {
            basenames.add(pat);
          }
        }
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { basenames, exts };
}

function triggerScan(source) {
  if (finder.isScanning()) return;
  console.log(`[${new Date().toISOString()}] Watch: changes detected — rescanning...`);
  finder.scanFiles();
}

function startWatcher(basePath) {
  try {
    const ignore = loadIgnorePatterns(basePath);

    watcher = fs.watch(basePath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const parts = filename.split('/');
      if (parts[0] === '.git') return;

      for (const part of parts) {
        if (ignore.basenames.has(part)) return;
        for (const suffix of ignore.exts) {
          if (part.endsWith(suffix)) return;
        }
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => triggerScan(filename), WATCH_DEBOUNCE_MS);
    });
    console.log(`👁  Watching ${basePath} for changes (debounce: ${WATCH_DEBOUNCE_MS}ms)`);
  } catch (err) {
    console.warn(`⚠️  Could not start file watcher: ${err.message}`);
  }
}

function stopWatcher() {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (watcher) { watcher.close(); watcher = null; }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

server.listen(args.sockPath, () => {
  console.log(`\n✅ Daemon listening on ${args.sockPath}`);
  console.log('   Send queries via ffgrep/fffind/fff-multi-grep, or connect directly.');
  if (args.watch) startWatcher(directory);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdownServer() {
  console.log('\n→ Shutting down daemon...');
  stopWatcher();
  try { fs.unlinkSync(args.sockPath); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdownServer);
process.on('SIGTERM', shutdownServer);
process.on('exit', () => { try { fs.unlinkSync(args.sockPath); } catch {} });
