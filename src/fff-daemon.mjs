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

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { resolveFffNode } from "./resolve-fff.mjs";

const { FileFinder } = await resolveFffNode();
const NAME = path.basename(process.argv[1] || "fff-daemon.mjs");

const SOCK_PATH = process.env.FFF_DAEMON_SOCK || "/tmp/fff.sock";
const CONTROL_OPS = new Set([
    "scan",
    "health",
    "shutdown",
    "watch-on",
    "watch-off",
]);

// ---------------------------------------------------------------------------
// Control command client (scan / health / shutdown)
// ---------------------------------------------------------------------------

function sendControl(op, sockPath) {
    const connectPath = sockPath || SOCK_PATH;
    return new Promise((resolve, reject) => {
        const sock = net.connect({ path: connectPath });
        let buf = "";
        let done = false;

        function finish(err, result) {
            if (done) return;
            done = true;
            try {
                sock.destroy();
            } catch {}
            if (err) reject(err);
            else resolve(result);
        }

        sock.setEncoding("utf8");
        sock.setTimeout(10000);

        sock.on("connect", () => {
            sock.write(JSON.stringify({ op, params: {} }) + "\n");
        });

        sock.on("data", (chunk) => {
            buf += chunk;
            const nl = buf.indexOf("\n");
            if (nl !== -1) {
                try {
                    const response = JSON.parse(buf.slice(0, nl));
                    if (!response.ok)
                        finish(new Error(response.error || "daemon error"));
                    else finish(null, response.result);
                } catch (e) {
                    finish(new Error(`Invalid daemon response: ${e.message}`));
                }
            }
        });

        sock.on("error", (e) => finish(e));
        sock.on("timeout", () => finish(new Error("Daemon timeout")));
        sock.on("close", () => {
            if (!done) finish(new Error("Daemon closed without response"));
        });
    });
}

async function runControl(op, sockPath) {
    try {
        const result = await sendControl(op, sockPath);
        if (op === "shutdown") {
            console.log("✅ Daemon signaled to shut down.");
        } else if (op === "scan") {
            console.log("✅ Scan triggered.");
            if (result) console.log(JSON.stringify(result, null, 2));
        } else if (op === "watch-on") {
            console.log(result.message || "Watch enabled.");
        } else if (op === "watch-off") {
            console.log(result.message || "Watch disabled.");
        } else {
            console.log(JSON.stringify(result, null, 2));
        }
        process.exit(0);
    } catch (e) {
        console.error(
            `Cannot reach daemon at ${sockPath || SOCK_PATH}: ${e.message}`,
        );
        console.error(
            "Is the daemon running? Start it with: fff-daemon [directory]",
        );
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
    sink("Server mode:");
    sink(`  ${NAME}               Start daemon for current directory`);
    sink(`  ${NAME} ~/my-project  Start daemon for specific directory`);
    sink();
    sink("Client control commands:");
    sink(`  ${NAME} scan          Trigger a rescan in the running daemon`);
    sink(`  ${NAME} health        Show daemon status`);
    sink(`  ${NAME} watch-on      Start watching for file changes`);
    sink(`  ${NAME} watch-off     Stop watching for file changes`);
    sink(`  ${NAME} shutdown      Stop the running daemon`);
    sink();
    sink("Options:");
    sink(
        "  --sock <path>                     Socket (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)",
    );
    sink("  --disable-watch                   Disable file watching");
    sink("  --ai-mode                         Enable AI-agent optimizations");

    sink();
    sink("Advanced Options (see documentation for details):");
    sink("  --frecency-db <path>              Frecency DB");
    sink("  --history-db <path>               History DB");
    sink("  --log-file-path <path>            Tracing log file path");
    sink(
        "  --log-level <level>               trace | debug | info | warn | error",
    );
    sink("  --cache-budget-max-files <n>      Cache file-count cap (0 = auto)");
    sink("  --cache-budget-max-bytes <n>      Cache byte cap (0 = auto)");
    sink(
        "  --cache-budget-max-file-size <n>  Cache per-file byte cap (0 = auto)",
    );
    sink(
        "  --disable-content-indexing        Reduces memory but cripples ffgrep",
    );
    sink(
        "  --disable-mmap-cache              Very slow ffgrep; and disables content indexing",
    );
    sink();
    sink("  --help                            Show this message");
    process.exit(exitCode);
}

function parseArgs(argv) {
    const result = {
        directory: undefined,
        frecencyDbPath: undefined,
        historyDbPath: undefined,
        sockPath: SOCK_PATH,
        disableWatch: false,
        aiMode: false,
        logFilePath: undefined,
        logLevel: undefined,
        cacheBudgetMaxFiles: 0,
        cacheBudgetMaxBytes: 0,
        cacheBudgetMaxFileSize: 0,
        disableContentIndexing: false,
        disableMmapCache: false,
        controlOp: undefined,
    };
    let disableContentIndexingExplicit = false;
    const remaining = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--help":
                showHelp();
                break;
            case "--frecency-db":
                result.frecencyDbPath = argv[++i];
                break;
            case "--history-db":
                result.historyDbPath = argv[++i];
                break;
            case "--sock":
                result.sockPath = argv[++i];
                break;
            case "--disable-watch":
                result.disableWatch = true;
                break;
            case "--ai-mode":
                result.aiMode = true;
                break;
            case "--log-file-path":
                result.logFilePath = argv[++i];
                break;
            case "--log-level":
                result.logLevel = argv[++i];
                break;
            case "--cache-budget-max-files": {
                const n = parseInt(argv[++i], 10);
                if (Number.isNaN(n)) { console.error(`${NAME}: --cache-budget-max-files requires a number`); process.exit(1); }
                result.cacheBudgetMaxFiles = n || 0;
                break;
            }
            case "--cache-budget-max-bytes": {
                const n = parseInt(argv[++i], 10);
                if (Number.isNaN(n)) { console.error(`${NAME}: --cache-budget-max-bytes requires a number`); process.exit(1); }
                result.cacheBudgetMaxBytes = n || 0;
                break;
            }
            case "--cache-budget-max-file-size": {
                const n = parseInt(argv[++i], 10);
                if (Number.isNaN(n)) { console.error(`${NAME}: --cache-budget-max-file-size requires a number`); process.exit(1); }
                result.cacheBudgetMaxFileSize = n || 0;
                break;
            }
            case "--disable-content-indexing":
                result.disableContentIndexing = true;
                disableContentIndexingExplicit = true;
                break;
            case "--disable-mmap-cache":
                result.disableMmapCache = true;
                break;
            default:
                if (arg.startsWith("-")) {
                    console.error(`${NAME}: unknown option: ${arg}`);
                    process.exit(1);
                }
                remaining.push(arg);
        }
    }
    // disable-mmap-cache implies disable-content-indexing unless explicitly set
    if (result.disableMmapCache && !disableContentIndexingExplicit) {
        result.disableContentIndexing = true;
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
    testSock.on("connect", () => {
        testSock.destroy();
        resolve(true);
    });
    testSock.on("error", () => {
        testSock.destroy();
        resolve(false);
    });
    testSock.setTimeout(200, () => {
        try {
            testSock.destroy();
        } catch {}
        resolve(false);
    });
});

if (alreadyRunning) {
    console.error(`❌ A daemon is already running on socket ${args.sockPath}`);
    console.error(
        "   Use a different --sock or stop the existing daemon first.",
    );
    process.exit(1);
}

// Clean up a stale socket file (no daemon listening)
try {
    fs.unlinkSync(args.sockPath);
} catch {}

// ---------------------------------------------------------------------------
// DB path resolution
// ---------------------------------------------------------------------------

function resolveDbPaths(basePath) {
    let frecencyDbPath = process.env.FFF_FRECENCY_DB ?? undefined;
    let historyDbPath = process.env.FFF_HISTORY_DB ?? undefined;

    if (!frecencyDbPath) {
        const autoBase = path.join(basePath, ".fff/frecency");
        try {
            if (fs.statSync(autoBase).isDirectory()) frecencyDbPath = autoBase;
        } catch {}
    }
    if (!historyDbPath) {
        const autoBase = path.join(basePath, ".fff/history");
        try {
            if (fs.statSync(autoBase).isDirectory()) historyDbPath = autoBase;
        } catch {}
    }
    return { frecencyDbPath, historyDbPath };
}

// ---------------------------------------------------------------------------
// Create FileFinder
// ---------------------------------------------------------------------------

const directory = args.directory || process.cwd();
const { frecencyDbPath, historyDbPath } = resolveDbPaths(directory);

// ---------------------------------------------------------------------------
// DB state
// ---------------------------------------------------------------------------

const dbInfo = [];
const fdb = args.frecencyDbPath ?? frecencyDbPath;
const hdb = args.historyDbPath ?? historyDbPath;
if (fdb) dbInfo.push(`frecency: ${fdb}`);
if (hdb) dbInfo.push(`history: ${hdb}`);

function buildFinderOpts(disableWatch) {
    const opts = {
        basePath: directory,
        aiMode: args.aiMode,
        disableWatch,
        frecencyDbPath: args.frecencyDbPath ?? frecencyDbPath,
        historyDbPath: args.historyDbPath ?? historyDbPath,
    };
    if (args.logFilePath) {
        opts.logFilePath = args.logFilePath;
        if (args.logLevel) opts.logLevel = args.logLevel;
    }
    if (args.cacheBudgetMaxFiles > 0)
        opts.cacheBudgetMaxFiles = args.cacheBudgetMaxFiles;
    if (args.cacheBudgetMaxBytes > 0)
        opts.cacheBudgetMaxBytes = args.cacheBudgetMaxBytes;
    if (args.cacheBudgetMaxFileSize > 0)
        opts.cacheBudgetMaxFileSize = args.cacheBudgetMaxFileSize;
    if (args.disableContentIndexing) opts.disableContentIndexing = true;
    if (args.disableMmapCache) opts.disableMmapCache = true;
    return opts;
}

let currentDisableWatch = args.disableWatch;
let finder;

async function createFinder(disableWatch) {
    console.log(`→ Creating FileFinder for: ${directory}`);
    const result = FileFinder.create(buildFinderOpts(disableWatch));
    if (!result.ok) throw new Error(result.error);
    const f = result.value;

    console.log("→ Waiting for initial scan...");
    const scanDone = await f.waitForScan(60000);
    if (!scanDone.ok || !scanDone.value) {
        console.warn("⚠️  Scan timeout; daemon is running with partial index.");
    }

    const progress = f.getScanProgress();
    const fileCount = progress.ok ? progress.value.scannedFilesCount : "?";
    console.log(
        `  Indexed ${fileCount} files${progress.ok && progress.value.isScanning ? " (scanning...)" : ""}`,
    );

    if (dbInfo.length > 0) console.log(`  Using DBs: ${dbInfo.join(", ")}`);
    return f;
}

async function recreateFinder(newDisableWatch) {
    if (newDisableWatch === currentDisableWatch) return;
    console.log(
        `\n→ Recreating FileFinder (disableWatch: ${newDisableWatch})...`,
    );
    try {
        finder.destroy();
    } catch (e) {
        console.warn(`Warning: destroy() failed: ${e.message}`);
    }
    finder = await createFinder(newDisableWatch);
    currentDisableWatch = newDisableWatch;
    announceWatching(directory, currentDisableWatch);
}

finder = await createFinder(currentDisableWatch);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function reconstructCursor(raw) {
    if (!raw || raw._offset === undefined) return null;
    return { __brand: "GrepCursor", _offset: raw._offset };
}

function serialiseResult(result) {
    return JSON.parse(
        JSON.stringify(result, (_key, val) => {
            if (
                val &&
                typeof val === "object" &&
                val.constructor &&
                val.constructor.name === "Buffer"
            ) {
                return val.toString("utf8");
            }
            return val;
        }),
    );
}

const handlers = {
    async find({ query, pageIndex = 0, pageSize = 30 }) {
        const r = finder.fileSearch(query, { pageIndex, pageSize });
        if (!r.ok) throw new Error(r.error);
        return { ...serialiseResult(r.value), _basePath: directory };
    },

    async grep({
        query,
        mode = "plain",
        smartCase = true,
        maxMatchesPerFile = 50,
        cursorRaw = null,
        beforeContext = 0,
        afterContext = 0,
    }) {
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
        return { ...serialiseResult(r.value), _basePath: directory };
    },

    async "multi-grep"({
        patterns,
        constraints = null,
        maxMatchesPerFile = 50,
        smartCase = true,
        cursorRaw = null,
        beforeContext = 0,
        afterContext = 0,
    }) {
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
        return { ...serialiseResult(r.value), _basePath: directory };
    },

    async scan() {
        if (finder.isScanning())
            return { message: "Scan already in progress." };
        finder.scanFiles();
        return { message: "Scan triggered." };
    },

    async health() {
        const health = finder.healthCheck();
        const filePicker = health.value.filePicker;
        const git = health.value.git;

        return {
            basePath: filePicker.basePath,
            initialized: health.ok ? filePicker.initialized : null,
            scannedFilesCount: health.ok ? filePicker.indexedFiles : null,
            scanning: health.ok ? filePicker.isScanning : null,
            git: git.repositoryFound ? `yes (${git.workdir})` : "no",
            watching: !currentDisableWatch,
            dbs: dbInfo.length
                ? dbInfo
                : "No frecency or history dbs configured",
            sockPath: args.sockPath,
            fffVersion: health.value.version,
            daemonArgs: args,
        };
    },

    async "watch-on"() {
        if (!currentDisableWatch) {
            return { message: "File watcher is already active." };
        }
        await recreateFinder(false);
        return { message: "File watcher enabled." };
    },

    async "watch-off"() {
        if (currentDisableWatch) {
            return { message: "File watcher is already disabled." };
        }
        await recreateFinder(true);
        return { message: "File watcher disabled." };
    },

    async shutdown() {
        setTimeout(() => shutdownServer(), 50);
        return { message: "Shutting down..." };
    },
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let activeConnections = 0;

function writeResponse(socket, payload) {
    socket.write(JSON.stringify(payload) + "\n");
}

const server = net.createServer((socket) => {
    activeConnections++;
    let buffer = "";

    socket.setEncoding("utf8");

    socket.on("data", (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);

            if (!line) continue;

            (async () => {
                try {
                    const req = JSON.parse(line);
                    console.log(
                        `[${new Date().toISOString()}] op=${req.op} > ${JSON.stringify(req.params || {})}`,
                    );
                    const handler = handlers[req.op];
                    if (!handler) {
                        writeResponse(socket, {
                            ok: false,
                            error: `Unknown op: ${req.op}`,
                        });
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

    socket.on("error", () => {});
    socket.on("close", () => {
        activeConnections--;
    });
});

// ---------------------------------------------------------------------------
// File watcher
//
// The FileFinder library has its own file watcher (notify-rs) which
// auto-updates the index. No Node.js fs.watch is needed.
// --disable-watch sets disableWatch: true in FileFinder.create().
// ---------------------------------------------------------------------------

function announceWatching(basePath, disabled) {
    if (disabled) {
        console.log(`⏸  File watcher disabled for ${basePath}`);
    } else {
        console.log(`👁  File watcher active for ${basePath}`);
    }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

server.listen(args.sockPath, () => {
    console.log(`\n✅ Daemon listening on ${args.sockPath}`);
    console.log(
        "   Send queries via ffgrep/fffind/fff-multi-grep, or connect directly.",
    );
    announceWatching(directory, args.disableWatch);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdownServer() {
    console.log("\n→ Shutting down daemon...");
    try {
        fs.unlinkSync(args.sockPath);
    } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", shutdownServer);
process.on("SIGTERM", shutdownServer);
process.on("exit", () => {
    try {
        fs.unlinkSync(args.sockPath);
    } catch {}
});
