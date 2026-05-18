#!/usr/bin/env node
/**
 * Standalone CLI wrapper around @ff-labs/fff-node for fuzzy file search.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const { resolveFffNode } = await import(path.join(SRC_DIR, 'resolve-fff.mjs'));
const { createStore } = await import(path.join(SRC_DIR, 'cursor-store.mjs'));
const { resolveDbPaths } = await import(path.join(SRC_DIR, 'db-paths.mjs'));
const {
  ipcAvailable, dslFind, setSockPath, getSockPath,
} = await import(path.join(SRC_DIR, 'ipc-client.mjs'));
const { normalizeConstraints } = await import(path.join(SRC_DIR, 'normalize-constraints.mjs'));

const { FileFinder } = await resolveFffNode();
const NAME = path.basename(process.argv[1] || 'fffind.mjs');
const cursors = createStore('fffind-cu' + 'rsors.json');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function showHelp(exitCode = 0) {
  const sink = exitCode === 0 ? console.log : console.error;
  sink(`Usage: ${NAME} <pattern> [options]`);
  sink('Options:');
  sink('  -c, --constraints <...>   Path filter constraints');
  sink('  -l, --limit <N>           Max results per page (default: 30)');
  sink('  -n, --cursor <id>         Page number (default: 1)');
  sink('  -s, --sock <path>         Daemon socket (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)');
  sink('');
  sink('Standalone Options (Non-Daemon mode):');
  sink('      --base <path>         Base directory');
  sink('      --frecency-db <path>  Frecency DB');
  sink('      --history-db <path>   History DB');
  sink('');
  sink('      --help                Show this message');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {
    pattern: undefined, basePath: process.cwd(), constraints: undefined,
    limit: 30, cursor: undefined,
    frecencyDbPath: undefined, historyDbPath: undefined, sockPath: undefined,
  };
  const remaining = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help': showHelp(); break;
      case '--base': result.basePath = argv[++i]; break;
      case '-c': case '--constraints': result.constraints = argv[++i]; break;
      case '-l': case '--limit': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --limit requires a number`); process.exit(1); }
        result.limit = n; break;
      }
      case '-n': case '--cursor': result.cursor = argv[++i]; break;
      case '--frecency-db': result.frecencyDbPath = argv[++i]; break;
      case '--history-db': result.historyDbPath = argv[++i]; break;
      case '-s': case '--sock': result.sockPath = argv[++i]; break;
      default:
        if (arg.startsWith('-')) { console.error(`${NAME}: unknown option: ${arg}`); process.exit(1); }
        remaining.push(arg);
    }
  }
  if (remaining.length > 0) {
    result.pattern = remaining[0];
    if (remaining.length > 1) result.basePath = remaining[1];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

function buildQuery(constraints, pattern) {
  const normConstraints = normalizeConstraints(constraints);
  return normConstraints ? `${normConstraints} ${pattern}` : pattern;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const HOT_FRECENCY = 25;
const WARM_FRECENCY = 20;
function fffFileAnnotation(item) {
  const g = item.gitStatus;
  if (g && g !== 'clean' && g !== 'unknown' && g !== '') return `  [${g} in git]`;
  const f = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0;
  if (f >= HOT_FRECENCY) return '  [VERY often touched file]';
  if (f >= WARM_FRECENCY) return '  [often touched file]';
  return '';
}

function renderOutput(result, effectiveLimit, pageIndex, basePath) {
  const root = result._basePath ?? basePath ?? '';
  const prefix = root ? root.replace(/\/$/, '') + '/' : '';
  const shown = result.items?.slice(0, effectiveLimit) ?? [];
  console.log(`\nFound ${result.totalMatched ?? 0} matches across ${result.totalFiles ?? '?'} indexed files\n`);
  for (const item of shown) console.log(`${prefix}${item.relativePath}${fffFileAnnotation(item)}`);

  const shownSoFar = pageIndex * effectiveLimit + (result.items?.length ?? 0);
  const hasMore = (result.items?.length ?? 0) >= effectiveLimit && (result.totalMatched ?? 0) > shownSoFar;
  const remaining = (result.totalMatched ?? 0) - shownSoFar;

  const notices = [];
  if (hasMore) {
    const nextPage = Math.floor(shownSoFar / effectiveLimit) + 1;
    notices.push(`${remaining} more match${remaining === 1 ? '' : 'es'} available. cursor="${nextPage}" to continue`);
  }
  if (notices.length > 0) console.log(`\n[${notices.join('. ')}]`);
  return { nextPageIndex: hasMore ? pageIndex + 1 : null };
}

// ---------------------------------------------------------------------------
// Local fallback
// ---------------------------------------------------------------------------

async function runLocal(args) {
  console.log(`→ Creating FileFinder for: ${args.basePath}`);
  const { frecencyDbPath, historyDbPath } = resolveDbPaths(args.basePath);
  const finderResult = FileFinder.create({
    basePath: args.basePath, aiMode: true,
    frecencyDbPath: args.frecencyDbPath ?? frecencyDbPath,
    historyDbPath: args.historyDbPath ?? historyDbPath,
  });
  if (!finderResult.ok) { console.error('Failed:', finderResult.error); process.exit(1); }
  const finder = finderResult.value;

  console.log('→ Waiting for scan...');
  const scanDone = await finder.waitForScan(30000);
  if (!scanDone.ok || !scanDone.value) console.warn('Scan timeout, proceeding...');
  const progressResult = finder.getScanProgress();
  if (progressResult.ok) console.log(`  Indexed ${progressResult.value.scannedFilesCount} files${progressResult.value.isScanning ? ' (scanning...)' : ''}`);
  const dbInfo = [];
  if (args.frecencyDbPath ?? frecencyDbPath) dbInfo.push('frecency');
  if (args.historyDbPath ?? historyDbPath) dbInfo.push('history');
  if (dbInfo.length > 0) console.log(`  Using DBs: ${dbInfo.join(', ')}`);
  return finder;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
if (args.sockPath) setSockPath(args.sockPath);
if (!args.pattern) showHelp(1);

const query = buildQuery(args.constraints, args.pattern);
const pageNum = parseInt(args.cursor || '1', 10);
const effectiveLimit = args.limit ?? 30;

let result, viaDaemon = false;

const daemonOk = await ipcAvailable();
if (daemonOk) {
  try {
    console.log(`→ [via daemon ${getSockPath()}] Searching: "${query}"`);
    viaDaemon = true;
    const stored = cursors.retrieve(cursors.makeQueryKey(args.pattern, args.constraints, args.limit), pageNum);
    if (pageNum !== 1 && !stored) {
      console.error(`Cursor ${pageNum} not found for this query. Run without --cursor first.`);
      process.exit(1);
    }
    const pageIndex = (pageNum === 1) ? 0 : (stored.pageIndex ?? 0);
    result = await dslFind(query, pageIndex, effectiveLimit);
  } catch (e) {
    console.warn('Daemon request failed, falling back to local:', e.message);
    result = null;
    viaDaemon = false;
  }
}

if (!result) {
  const finder = await runLocal(args);
  const stored = cursors.retrieve(cursors.makeQueryKey(args.pattern, args.constraints, args.limit), pageNum);
  if (pageNum === 1) {
    const searchResult = finder.fileSearch(query, { pageIndex: 0, pageSize: effectiveLimit });
    if (!searchResult.ok) { console.error('Search failed:', searchResult.error); process.exit(1); }
    result = searchResult.value;
  } else {
    if (!stored) {
      console.error(`Cursor ${pageNum} not found for this query. Run without --cursor first.`);
      process.exit(1);
    }
    const searchResult = finder.fileSearch(query, { pageIndex: stored.pageIndex, pageSize: stored.pageSize });
    if (!searchResult.ok) { console.error('Search failed:', searchResult.error); process.exit(1); }
    result = searchResult.value;
  }
}

const pageIndex = viaDaemon
  ? Math.max(0, pageNum - 1)
  : ((pageNum === 1) ? 0 : (cursors.retrieve(cursors.makeQueryKey(args.pattern, args.constraints, args.limit), pageNum)?.pageIndex ?? 0));

const meta = renderOutput(result, effectiveLimit, pageIndex, args.basePath);

if (meta.nextPageIndex !== null) {
  const nextPage = pageNum + 1;
  cursors.store(cursors.makeQueryKey(args.pattern, args.constraints, args.limit), args.pattern, args.constraints, args.limit, nextPage, {
    query, pattern: args.pattern, pageSize: effectiveLimit, pageIndex: meta.nextPageIndex,
  });
}
