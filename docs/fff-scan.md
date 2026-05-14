# fff-scan

Pre-scan a directory to populate FFF's file index and optionally warm the frecency/history databases. Running this before a batch of `ffgrep`/`fffind`/`fff-multi-grep` calls eliminates per-invocation scan overhead.

## Usage

```bash
fff-scan <directory> [options]
```

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `directory` | path | *(required)* | Directory to scan and index |
| `--pattern` | string | — | Pattern to warm frecency/history DBs after scan |
| `--find` | flag | — | Treat `--pattern` as a file-search pattern |
| `--grep` | flag | — | Treat `--pattern` as a content-search pattern (default) |
| `--constraints` | string | — | Include/exclude filters |
| `--literal` | flag | — | Force literal match (`--grep` only) |
| `--regex` | flag | — | Force regex match (`--grep` only) |
| `--ignore-case` | flag | false | Case-insensitive (`--grep` only) |
| `--context` | number | 0 | Context lines (`--grep` only) |
| `--limit` | number | 100 | Max results to warm (default: 100) |
| `--frecency-db` | path | — | Path to frecency DB |
| `--history-db` | path | — | Path to history DB |

## Environment variables

Same as other fff-cli tools: `FFF_FRECENCY_DB`, `FFF_HISTORY_DB`, `FFF_CURSORS_DIR`.

## Examples

### Scan only (no warming)

```bash
fff-scan ~/my-project
```

```
→ Creating FileFinder for: /home/user/my-project
→ Scanning...
  Indexed 3421 files
  Using DBs: frecency, history

✅ Scanned 3421 files.
```

### Scan + warm with a grep pattern

```bash
fff-scan ~/my-project --pattern "TODO" --grep --limit 50
```

```
→ Creating FileFinder for: /home/user/my-project
→ Scanning...
  Indexed 3421 files
  Using DBs: frecency, history
→ Warming frecency/history: grep: "TODO"
  Wrote 50 match(es) across 12 file(s) to frecency DB

✅ Scan + warm complete.
```

### Scan + warm with a file-search pattern

```bash
fff-scan ~/my-project --pattern "src/**/*.ts" --find --limit 20
```

```
→ Creating FileFinder for: /home/user/my-project
→ Scanning...
  Indexed 3421 files
  Using DBs: frecency, history
→ Warming frecency/history: fileSearch: "src/**/*.ts"
  Wrote 20 file(s) to frecency DB

✅ Scan + warm complete.
```

## How it helps

Each fff-cli tool (`ffgrep`, `fffind`, `fff-multi-grep`) creates a fresh `FileFinder` per invocation, so it re-scans the filesystem every time. `fff-scan` serves two purposes:

1. **Pre-warm the file-system cache** — the first scan primes OS and FFF caches; subsequent invocations may see faster scanning (though each tool still creates its own index).
2. **Warm the frecency/history DBs** — by running queries with `--pattern`, you populate shared LMDB databases that persist across invocations. Files and queries you warm will rank higher in later searches.

The frecency DB is shared across all fff-cli invocations if they use the same `--frecency-db` path (or auto-detect the same one).

## Warming strategy

- **Warm with `--find`** when you want certain file types or directories to rank higher.
  ```bash
  fff-scan ~/repo --pattern "src/" --find --limit 100
  fff-scan ~/repo --pattern "*.ts" --find --limit 100
  ```
- **Warm with `--grep`** when you want certain identifiers or keywords to boost their containing files.
  ```bash
  fff-scan ~/repo --pattern "TODO|FIXME" --grep --limit 100
  ```
- Frecency scores accumulate — running multiple `fff-scan` passes is safe and additive.
