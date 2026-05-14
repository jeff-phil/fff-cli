# ffgrep

Content search using FFF (Fast File Finder) — regex and literal grep with frecency ranking, smart case, and fuzzy fallback. Think of it like `rg` but with frecency-aware result ranking.

## Usage

```bash
ffgrep <pattern> [options]
```

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pattern` | string | *(required)* | Search text or regex |
| `--constraints` | string | — | Path constraints: includes and excludes (e.g. `"src/ *.ts !test/ !*.min.js"`) |
| `--ignore-case` | flag | false | Force case-insensitive matching |
| `--regex` | flag | — | Treat pattern as regex (overrides auto-detect) |
| `--literal` | flag | — | Treat pattern as literal string (overrides auto-detect) |
| `--context` | number | 0 | Context lines before and after each match |
| `--limit` | number | 100 | Maximum matches **per file** (capped at 50). Controls how many matching lines are returned from any single file. **Not** a total page — all matching files are included, each limited to this value. |
| `--cursor` | string | 1 | Page number to resume (default: 1, same as no `--cursor`) |
| `--base` | path | `cwd` | Base directory to search |
| `--frecency-db` | path | — | Path to frecency database directory |
| `--history-db` | path | — | Path to query history database directory |

## Environment variables

| Variable | Effect |
|---|---|
| `FFF_FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |
| `FFF_FRECENCY_DB` | Override frecency database path |
| `FFF_HISTORY_DB` | Override query history database path |
| `FFF_CURSORS_DIR` | Cursor storage directory (default: `/tmp`) |
| `FFF_DAEMON_SOCK` | Unix socket path for `fff-daemon` (default: `/tmp/fff.sock`) |

The CLI auto-detects databases in this order:
1. `{basePath}/.local/share/fff/{frecency,history}` (project-local)
2. `~/.local/share/fff/{frecency,history}` (user home)

Command-line flags take precedence, then env vars, then auto-detection.

## Constraints syntax

`--constraints` accepts a space or comma-separated string of path filters. Prefix with `!` to exclude.

| Constraint | Meaning |
|---|---|
| `src/` | Only search in `src/` directory |
| `*.ts` | Only search `.ts` files |
| `src/**/*.ts` | Only search `.ts` files under `src/` |
| `!test/` | Exclude `test/` directory |
| `!*.min.js` | Exclude minified JS files |
| `"src/ *.ts !test/ !*.min.js"` | Include `src/`, `.ts` files; exclude `test/` and minified JS |

## Daemon mode

If `fff-daemon` is running for `--base`, `ffgrep` connects via Unix domain socket instead of creating its own `FileFinder`. The query is executed instantly against the warm in-memory index — no scan delay.

```bash
# Terminal 1
fff-daemon ~/my-project

# Terminal 2 — instant
ffgrep "TODO" --base ~/my-project
```

If no daemon is listening, `ffgrep` falls back to local mode automatically (creates its own FileFinder, waits for scan). Control the socket path with `FFF_DAEMON_SOCK`.

## How it works

- Creates an FFF `FileFinder` for the base directory
- Waits for the initial file scan to complete
- Auto-detects regex vs literal mode (unless overridden)
- Respects smart case by default (case-insensitive when pattern is all lowercase)
- Results are ranked by **frecency** (most-accessed files first)
- Matches within a file stay in source order
- Respects both `.gitignore` and `.ignore`

## Examples

### Basic search

```bash
ffgrep "registerCommand" --limit 5
```

```
extensions/emacs-org-cli.ts
 537: pi.registerCommand("org-cli-info", {

extensions/exit-command.ts
  10: pi.registerCommand("exit", {

Matched 2 lines across 2731 files searched (2731 eligible)
```

### With context and constraints

```bash
ffgrep "registerTool" --constraints "extensions/emacs-org-cli.ts" --context 2 --limit 5
```

Shows matches with 2 lines of surrounding context in the specified file.

### Search outside the base directory

```bash
ffgrep "TypeDecorator" \
  --base ~/.pi/agent/.local/share/dedoc \
  --constraints "sqlalchemy/core" \
  --limit 5
```

### Regex mode with constraints

```bash
ffgrep "^import" --constraints "extensions" --regex --limit 5
```

### Include and exclude together

```bash
ffgrep "exit" --constraints "*.ts !.local/" --limit 5
```

### Force literal (pipe chars are literal, not regex alternation)

```bash
ffgrep "registerCommand|registerTool" --literal --limit 3
# → No matches (correct — the literal string "registerCommand|registerTool" does not occur)
```

## About `--limit`

`--limit` sets `maxMatchesPerFile` in the FFF engine. It does **not** cap the total
global results — it only caps how many lines are returned from each individual file.
If 20 files match, you get up to 20 × limit lines.

| `--limit` | Effective per-file cap | Notes |
|---|---|---|
| 1–50 | The value you passed | 3 → 3 lines per file |
| 51–100 | 50 | Hard engine ceiling |
| > 100 | 50 | Same ceiling |

Examples:

```bash
# Common files have ~50 matches each; keep output readable
ffgrep "TODO" --limit 3
# Shows up to 3 lines from every file that contains "TODO".

# Let the engine show as many as it will (50 per file)
ffgrep "TODO" --limit 50
```

## Pagination

Pagination uses cursors that track a byte offset inside the result stream. Each
page can be a **different number of lines** depending on how many files matched and
how many lines each file contributed.

```bash
# Page 1
ffgrep "TODO" --limit 5
# → 5 lines from file-a.txt, 5 lines from file-b.txt, ...
# → [Continue with cursor="2"]

# Page 2 resumes after the last byte offset
ffgrep "TODO" --cursor 2 --limit 5
# → Next batch of 5-per-file from files that continue

# A different query starts fresh at cursor 1
ffgrep "FIXME" --limit 5
# → [Continue with cursor="2"]
```

Each unique `pattern|constraints|limit` gets its own cursor namespace — changing
either key restarts pagination at page 1.

Cursor state is stored in `${FFF_CURSORS_DIR:-/tmp}/ffgrep-cursors.json` and
expires after 24 hours or when the store exceeds 200 entries.

## Safety features

- **Wildcard guard**: Patterns like `.*`, `.*?`, `.+` are rejected with an error because they match everything
- **Regex fallback**: If `--regex` is used with an invalid regex, the engine falls back to literal matching and reports the compilation error
- **Smart case**: Case-insensitive when the pattern is all lowercase, case-sensitive otherwise (override with `--ignore-case`)
