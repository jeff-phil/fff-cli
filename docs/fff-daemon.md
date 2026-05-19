# fff-daemon

Long-running FFF indexer and IPC server. Keeps a `FileFinder` in memory so searches are instant — no per-invocation scan overhead. The CLI tools connect automatically when a daemon is running (and know the socket path).

## Usage

### Start the daemon

```bash
fff-daemon [directory|command] [options]
```

If no directory is given, uses the current working directory.

```bash
# Terminal 1
fff-daemon ~/projects/my-project

# Daemon output:
→ Creating FileFinder for: /home/user/my-project
→ Waiting for initial scan...
  Indexed 3421 files
 Daemon listening on /tmp/fff.sock
 File watcher active for /home/user/my-project
```

### Control a running daemon

```bash
fff-daemon health                            # Show daemon status
fff-daemon scan                              # Trigger a rescan
fff-daemon watch-on                          # Enable file watching (will cause rescan)
fff-daemon watch-off                         # Disable file watching (will cause rescan)
fff-daemon shutdown                          # Stop the default daemon, gracefully
fff-daemon health --sock /tmp/fff-dev.sock   # Control a custom-socket daemon
```

Control commands respect `--sock` just like server startup does. You can run
multiple daemons on different sockets and target them individually using the `--sock` parameter.

## Parameters

### Basic parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `directory` | path | `cwd` | Directory to index and serve |
| `--sock` | path | `/tmp/fff.sock` | Unix domain socket path |
| `--disable-watch` | flag | — | Disable the file watcher |
| `--ai-mode` | flag | `false` | Enable AI-agent optimizations |
| `--help` | flag | — | Show usage |

### Advanced parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `--frecency-db` | path | — | Frecency database directory. This parameter overrides the `$FFF_FRECENCY_DB` environment variable, and the default is the base directory where daemon is running under `.fff/frecency/`. Note: Directory must exist to be used, or else daemon is running stateless, use `fff-daemon health` to see if configured. |
| `--history-db` | path | — | Query history database directory. This parameter overrides the `$FFF_HISTORY_DB` environment variable, and the default is the base directory where daemon is running under `.fff/history/`. Note: Directory must exist to be used, or else daemon is running stateless, use `fff-daemon health` to see if configured. |
| `--log-file-path` | path | — | Tracing log file path used in debugging the fff library, and used for fff library debugging and monitoring. |
| `--log-level` | string | — | `trace`, `debug`, `info`, `warn`, `error`. Ignored unless `--log-file-path` is set, and used for fff library debugging and monitoring. |
| `--cache-budget-max-files` | int | `0` | Content cache file-count cap (0 = auto).|
| `--cache-budget-max-bytes` | int | `0` | Content cache byte cap (0 = auto) |
| `--cache-budget-max-file-size` | int | `0` | Content cache per-file byte cap (0 = auto) |
| `--disable-content-indexing` | flag | — | Reduces memory but significantly slows `ffgrep` like not running in daemon mode. |
| `--disable-mmap-cache` | flag | — | Very slow `ffgrep` like not running in daemon mode. Note: Turning off mmap cache also disables content indexing. |



## Environment variables

| Variable | Effect |
|---|---|
| `FFF_DAEMON_SOCK` | Override socket path (default: `/tmp/fff.sock`) |
| `FFF_FRECENCY_DB` | Frecency database directory |
| `FFF_HISTORY_DB` | Query history database directory |
|`FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |

## How it works

- Scans the directory once and keeps the index in memory
- Listens on a Unix domain socket for JSON requests
- All fff-cli tools (`ffgrep`, `fffind`, `fff-multi-grep`) auto-connect when a daemon is running
- Falls back silently to local mode if no daemon is listening
- **File watching** — the `FileFinder` library uses `notify-rs` (FSEvents on macOS, inotify on Linux) for incremental auto-updates
- Trigger full rescans manually with `fff-daemon scan`, which may be needed after a major set of file changes, like a git merge, to ensure everything is indexed.

## File watching

The `@ff-labs/fff-node` library manages its own file watcher internally. When the daemon starts:

```bash
fff-daemon ~/projects/my-project
```

Output:
```
 File watcher active for /home/user/my-project
```

To disable it (e.g. for large repos where watching is too expensive):

```bash
fff-daemon ~/projects/my-project --disable-watch
```

Output:
```
  File watcher disabled for /home/user/my-project
```

| Mode | Effect |
|---|---|
| Default (no flag) | `notify-rs` watches the tree and incrementally updates the index |
| `--disable-watch` | No watching; index only updates on `fff-daemon scan` or daemon restart |

`watch-on`/`watch-off` control commands recreate the `FileFinder` with `disableWatch: false` / `disableWatch: true`. This triggers a full rescan after recreation.

## IPC protocol

The daemon speaks a simple line-delimited JSON protocol:

**Request:**
```bash
echo '{"op":"health","params":{}}' | nc -U /tmp/fff.sock
```

**Response:**
```json
{"ok":true,"result":{"basePath":"/home/user/my-project","scannedFilesCount":3421,"scanning":false,"git":"yes (/home/user/my-project)","watching":true,"dbs":["frecency","history"],"sockPath":"/tmp/fff.sock"}}
```

### Supported operations

| Op | Params | Description |
|---|---|---|
| `find` | `query`, `pageIndex`, `pageSize` | Fuzzy file search |
| `grep` | `query`, `mode`, `smartCase`, `maxMatchesPerFile`, `pageSize`, `cursorRaw`, `beforeContext`, `afterContext` | Content search |
| `multi-grep` | `patterns`, `constraints`, `maxMatchesPerFile`, `pageSize`, `smartCase`, `cursorRaw`, `beforeContext`, `afterContext` | Multi-pattern OR search |
| `scan` | — | Trigger full rescan |
| `health` | — | Get daemon status (includes `watching` boolean) |
| `watch-on` | — | Enable file watcher |
| `watch-off` | — | Disable file watcher |
| `shutdown` | — | Gracefully stop the daemon |

## Why use the daemon?

Without the daemon, each tool invocation creates its own `FileFinder` and re-scans the filesystem (typically 1–5 seconds for medium repos). With the daemon:

| Scenario | Without daemon | With daemon |
|---|---|---|
| First search | ~2–5s scan + search | ~2–5s once (daemon startup), instant after |
| Second search | ~2–5s scan + search | Instant |
| Batch of 10 searches | ~20–50s total | ~2–5s + 10× instant |

## Example workflow

```bash
# Terminal 1: start daemon for the project
fff-daemon ~/projects/my-project

# Terminal 2: instant queries (no scan delay)
ffgrep "TODO" --limit 10
fffind "*.ts" --limit 5
fff-multi-grep "FIXME,HACK" --limit 10

# After git pull, the watcher auto-updates the index.
# For very large changes you may want a full rescan:
fff-daemon scan

# When done
fff-daemon shutdown
```

## Running in the background

```bash
# Detached, survives terminal
nohup fff-daemon ~/projects/my-project > /tmp/fff-daemon.log 2>&1 &

# Systemd or launchd integration can use the same command
```

## Multiple projects

Use different socket paths to run multiple daemons:

```bash
fff-daemon ~/project-a --sock /tmp/fff-a.sock
fff-daemon ~/project-b --sock /tmp/fff-b.sock

# Clients use env var
FFF_DAEMON_SOCK=/tmp/fff-a.sock ffgrep "foo" --base ~/project-a
```
