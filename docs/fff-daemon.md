# fff-daemon

Long-running FFF indexer and IPC server. Keeps a `FileFinder` in memory so searches are instant — no per-invocation scan overhead. The CLI tools connect automatically when a daemon is running (and know the socket path).

## Usage

### Start the daemon

```bash
fff-daemon [directory] [options]
```

If no directory is given, uses the current working directory.

```bash
# Terminal 1
fff-daemon ~/my-project

# Daemon output:
→ Creating FileFinder for: /home/user/my-project
→ Waiting for initial scan...
  Indexed 3421 files
  Daemon listening on /tmp/fff.sock
```

### Control a running daemon

```bash
fff-daemon health                            # Show daemon status
fff-daemon scan                              # Trigger a rescan
fff-daemon watch-on                          # Start watching for file changes
fff-daemon watch-off                         # Stop watching for file changes
fff-daemon shutdown                          # Stop the default daemon
fff-daemon health --sock /tmp/fff-dev.sock   # Control a custom-socket daemon
```

Control commands respect `--sock` just like server startup does. You can run
multiple daemons on different sockets and target them individually.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `directory` | path | `cwd` | Directory to index and serve |
| `--sock` | path | `/tmp/fff.sock` | Unix domain socket path |
| `--frecency-db` | path | — | Frecency database directory |
| `--history-db` | path | — | Query history database directory |
| `--watch` | flag | — | Watch base directory for changes and auto-rescan |
| `--help` | flag | — | Show usage |

## Environment variables

| Variable | Effect |
|---|---|
| `FFF_DAEMON_SOCK` | Override socket path (default: `/tmp/fff.sock`) |
| `FFF_FRECENCY_DB` | Frecency database directory |
| `FFF_HISTORY_DB` | Query history database directory |

## How it works

- Scans the directory once and keeps the index in memory
- Listens on a Unix domain socket for JSON requests
- All fff-cli tools (`ffgrep`, `fffind`, `fff-multi-grep`) auto-connect when a daemon is running
- Falls back silently to local mode if no daemon is listening
- Trigger rescans manually with `fff-daemon scan`, or use `--watch` for automatic rescans

## File watching (`--watch`)

Enable file-system watching and automatic rescans:

```bash
fff-daemon ~/my-project --watch
```

Output:
```
  Watching /home/user/my-project for changes (debounce: 500ms)
```

**Debounce:** Changes are debounced for **500ms**. Rapid bursts (e.g. a `git checkout` touching many files) collapse into a single rescan.

**Scan lock:** If a scan is already running when another change fires, it's skipped.

**Ignored paths:** `.git/` is always ignored.

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
| `grep` | `query`, `mode`, `smartCase`, `maxMatchesPerFile`, `cursorRaw`, `beforeContext`, `afterContext` | Content search |
| `multi-grep` | `patterns`, `constraints`, `maxMatchesPerFile`, `smartCase`, `cursorRaw`, `beforeContext`, `afterContext` | Multi-pattern OR search |
| `scan` | — | Trigger rescan |
| `health` | — | Get daemon status (includes `watching` boolean) |
| `watch-on` | — | Set watching status flag |
| `watch-off` | — | Clear watching status flag |
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
fff-daemon ~/my-project --watch

# Terminal 2: instant queries (no scan delay)
ffgrep "TODO" --limit 10
fffind "*.ts" --limit 5
fff-multi-grep "FIXME,HACK" --limit 10

# After git pull, the native watcher auto-updates; no manual rescan needed

# When done
fff-daemon shutdown
```

## Running in the background

```bash
# Detached, survives terminal
nohup fff-daemon ~/my-project > /tmp/fff-daemon.log 2>&1 &

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
