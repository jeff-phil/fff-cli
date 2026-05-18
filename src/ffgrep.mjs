#!/usr/bin/env node
/**
 * Standalone CLI wrapper around @ff-labs/fff-node for command-line grep.
 *
 * Usage:
 *   ffgrep <pattern> [options]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const { resolveFffNode } = await import(path.join(SRC_DIR, 'resolve-fff.mjs'));
const { createStore } = await import(path.join(SRC_DIR, 'cursor-store.mjs'));
const { resolveDbPaths } = await import(path.join(SRC_DIR, 'db-paths.mjs'));
const {
  ipcAvailable, dslGrep, setSockPath, getSockPath,
} = await import(path.join(SRC_DIR, 'ipc-client.mjs'));
const { formatGrepOutput } = await import(path.join(SRC_DIR, 'grep-format.mjs'));
const { normalizeConstraints } = await import(path.join(SRC_DIR, 'normalize-constraints.mjs'));

const { FileFinder } = await resolveFffNode();
const NAME = path.basename(process.argv[1] || 'ffgrep.mjs');
const cursors = createStore('ffgrep-cu' + 'rsors.json');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function showHelp(exitCode = 0) {
  const sink = exitCode === 0 ? console.log : console.error;
  sink(`Usage: ${NAME} <pattern> [options]`);
  sink('Options:');
  sink('  -c, --constraints <...>   Path filter constraints');
  sink('  -i, --ignore-case         Case-insensitive (default: smartCase)');
  sink('  -e, --regex               Force regex');
  sink('      --literal             Force literal');
  sink('      --context <N>         Context lines before and after each match');
  sink('  -b, --before-context <N>  Lines before each match');
  sink('  -a, --after-context <N>   Lines after each match');
  sink('  -l, --limit <N>           Max matches per file, capped at 50 (default: 100)');
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
    pattern: undefined, basePath: undefined, constraints: undefined,
    ignoreCase: false, literal: undefined,
    beforeContext: 0, afterContext: 0,
    limit: 100, cursor: undefined,
    frecencyDbPath: undefined, historyDbPath: undefined, sockPath: undefined,
  };
  const remaining = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help': showHelp(); break;
      case '-c': case '--constraints': result.constraints = argv[++i]; break;
      case '-i': case '--ignore-case': result.ignoreCase = true; break;
      case '-e': case '--regex': result.literal = false; break;
      case '--literal': result.literal = true; break;
      case '--context': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --context requires a number`); process.exit(1); }
        result.beforeContext = n; result.afterContext = n; break;
      }
      case '-b': case '--before-context': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --before-context requires a number`); process.exit(1); }
        result.beforeContext = n; break;
      }
      case '-a': case '--after-context': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --after-context requires a number`); process.exit(1); }
        result.afterContext = n; break;
      }
      case '-l': case '--limit': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --limit requires a number`); process.exit(1); }
        result.limit = n; break;
      }
      case '-n': case '--cursor': result.cursor = argv[++i]; break;
      case '--base': result.basePath = argv[++i]; break;
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
    if (remaining.length > 1 && !result.basePath) result.basePath = remaining[1];
  }
  if (!result.basePath) result.basePath = process.cwd();
  return result;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

function resolveGrepMode(pattern, literal) {
  if (literal === true) return 'plain';
  if (literal === false) return 'regex';
  const hasMeta = pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (hasMeta) { try { new RegExp(pattern); return 'regex'; } catch { return 'plain'; } }
  return 'plain';
}

// ---------------------------------------------------------------------------
// Wildcard guard
// ---------------------------------------------------------------------------

function isWildcardOnly(pattern) {
  const p = pattern.trim();
  const hasMeta = p !== p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return hasMeta && /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.*\??|\.*[*+?]?|\.+|\*|\?)$/.test(p);
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
  const progress = finder.getScanProgress();
  if (progress.ok) console.log(`  Indexed ${progress.value.scannedFilesCount} files${progress.value.isScanning ? ' (scanning...)' : ''}`);
  const dbInfo = [];
  if (args.frecencyDbPath ?? frecencyDbPath) dbInfo.push('frecency');
  if (args.historyDbPath ?? historyDbPath) dbInfo.push('history');
  if (dbInfo.length > 0) console.log(`  Using DBs: ${dbInfo.join(', ')}`);

  if (isWildcardOnly(args.pattern)) {
    console.error(`Pattern '${args.pattern}' matches everything — provide a concrete substring or identifier.`);
    process.exit(1);
  }

  const mode = resolveGrepMode(args.pattern, args.literal);
  const normalizedConstraints = normalizeConstraints(args.constraints);
  const query = normalizedConstraints ? `${normalizedConstraints} ${args.pattern}` : args.pattern;
  console.log(`→ Grepping: "${query}" (mode: ${mode})`);

  const queryKey = cursors.makeQueryKey(args.pattern, args.constraints, args.limit);
  const pageNum = parseInt(args.cursor || '1', 10);
  const stored = cursors.retrieve(queryKey, pageNum);
  let nativeCursor = null;

  if (pageNum === 1) nativeCursor = null;
  else {
    if (!stored) {
      console.error(`Cursor ${pageNum} not found for this query. Run without --cursor first, or use a valid page number.`);
      process.exit(1);
    }
    nativeCursor = { __brand: 'GrepCursor', _offset: stored.offset };
  }

  const grepResult = finder.grep(query, {
    mode, smartCase: !args.ignoreCase,
    maxMatchesPerFile: Math.min(Math.max(1, args.limit), 50),
    cursor: nativeCursor,
    beforeContext: args.beforeContext, afterContext: args.afterContext,
    classifyDefinitions: true,
  });
  if (!grepResult.ok) { console.error('Grep failed:', grepResult.error); process.exit(1); }
  return grepResult.value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
if (args.sockPath) setSockPath(args.sockPath);
if (!args.pattern) showHelp(1);

const mode = resolveGrepMode(args.pattern, args.literal);
const normalizedConstraints = normalizeConstraints(args.constraints);
const query = normalizedConstraints ? `${normalizedConstraints} ${args.pattern}` : args.pattern;

let result;
let viaDaemon = false;

const daemonOk = await ipcAvailable();
if (daemonOk) {
  try {
    console.log(`→ [via daemon ${getSockPath()}] Grepping: "${query}" (mode: ${mode})`);
    viaDaemon = true;
    const queryKey = cursors.makeQueryKey(args.pattern, args.constraints, args.limit);
    const pageNum = parseInt(args.cursor || '1', 10);
    const stored = cursors.retrieve(queryKey, pageNum);
    let cursorRaw = null;
    if (pageNum !== 1) {
      if (!stored) {
        console.error(`Cursor ${pageNum} not found for this query. Run without --cursor first, or use a valid page number.`);
        process.exit(1);
      }
      cursorRaw = { _offset: stored.offset };
    }
    result = await dslGrep(query, {
      mode,
      smartCase: !args.ignoreCase,
      limit: args.limit,
      cursorRaw,
      beforeContext: args.beforeContext,
      afterContext: args.afterContext,
    });
  } catch (e) {
    console.warn('Daemon request failed, falling back to local:', e.message);
    result = null;
    viaDaemon = false;
  }
}

if (!result) {
  result = await runLocal(args);
}

let output = formatGrepOutput(result, args.basePath);
const notices = [];
if (result.regexFallbackError) notices.push(`Invalid regex: ${result.regexFallbackError}, used literal match`);
if (result.nextCursor || result.nextCursor === null) {
  // Daemon returns nextCursor as plain object; local returns native cursor object
  const nextOffset = result.nextCursor?._offset ?? null;
  if (nextOffset !== null) {
    const nextPage = parseInt(args.cursor || '1', 10) + 1;
    const queryKey = cursors.makeQueryKey(args.pattern, args.constraints, args.limit);
    cursors.store(queryKey, args.pattern, args.constraints, args.limit, nextPage, { offset: nextOffset });
    notices.push(`Continue with cursor="${nextPage}"`);
  }
}
if (viaDaemon) notices.push('via daemon');
if (notices.length > 0) output += `\n\n[${notices.join('. ')}]`;

console.log('\n' + output + '\n');

const totalMatched = result.totalMatched ?? result.items?.length ?? 0;
const totalFilesSearched = result.totalFilesSearched ?? '?';
const filteredFileCount = result.filteredFileCount ?? '?';
console.log(`Matched ${totalMatched} lines across ${totalFilesSearched} files searched (${filteredFileCount} eligible)`);
