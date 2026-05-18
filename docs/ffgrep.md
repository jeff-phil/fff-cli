# ffgrep

Content search using FFF (Fast File Finder) — regex and literal grep with frecency ranking, smart case, and fuzzy fallback. Think of it like `rg` but with frecency-aware result ranking.

"Daemon Mode" is when `ffgrep` connects to a running `fff-daemon` socket for queries. In "Standalone", or Non-Daemon Mode, `ffgrep` will scan before each query resulting which will affect performance of returned results.

## Usage

```bash
ffgrep <pattern> [options]
```

## Parameters

### Parameters for both Daemon and Standalone modes

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pattern` | string | *(required)* | Search text or regex |
| `-c`, `--constraints` | string | — | Path filter constraints: includes and excludes (e.g. `"src/ *.ts !test/ !*.min.js"`) |
| `-i`, `--ignore-case` | flag | false | Force case-insensitive matching (default: smartCase) |
| `-e`, `--regex` | flag | — | Treat pattern as regex (overrides auto-detect) |
| `--literal` | flag | — | Treat pattern as literal string (overrides auto-detect) |
| `--context` | number | 0 | Lines of context before **and** after each match. Sets both `--before-context` and `--after-context`. |
| `-b`, `--before-context` | number | 0 | Lines to show before each match |
| `-a`, `--after-context` | number | 0 | Lines to show after each match |
| `-l`, `--limit` | number | 50 | Maximum matches **per file**. Controls how many matching lines are returned from any single file. **Not** a total page — all matching files are included, each limited to this value. Range 1–100. |
| `-p`, `--page-size` | number | 50 | Number of matched lines per page. 0 = use engine default (50). Note: More may be included to include entire limit per file. |
| `-n`, `--cursor` | string | 1 | Page number to resume (default: 1, same as no `--cursor`) |
| `-s`, `--sock` | path | — | Unix socket for `fff-daemon` (overrides `FFF_DAEMON_SOCK`) |


### Parameters for only Standalone (Non-Daemon) mode

| Parameter | Type | Default | Description |
|---|---|---|---|
| `--base` | path | `cwd` | Base directory to search. Passing this flag forces standalone (non-daemon) mode. |
| `--frecency-db` | path | — | Path to frecency database directory |
| `--history-db` | path | — | Path to query history database directory |

## Environment variables

| Variable | Effect |
|---|---|
| `FFF_FRECENCY_DB` | Override frecency database path |
| `FFF_HISTORY_DB` | Override query history database path |
| `FFF_CURSORS_DIR` | Cursor storage directory (default: `~/.local/cache/fff/cursors`) |
| `FFF_DAEMON_SOCK` | Unix socket path for `fff-daemon` (default: `/tmp/fff.sock`). Overridden by `--sock` |
| `FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |

The CLI auto-detects databases in this order:
1. `{basePath}/.fff/{frecency,history}` (project-local)
2. `~/.local/cache/fff/{frecency,history}` (user home)

Command-line flags take precedence, then env vars, then auto-detection.

## `--constraints` syntax

`--constraints` accepts a space-separated string of path filters. Constraints are normalized:

- **Bare directory names** are expanded to recursive globs (`src` → `src/` → `src/**`).
- **Glob patterns and file extensions** pass through as-is (`*.{ts,tsx}`, `*.py`).
- **Brace groups** `{a,b,c}` are preserved and commas inside them are left untouched.
- **Consecutive bare-dir constraints** are grouped into a single brace group for better engine performance: `python pydantic` → `{python/**,pydantic/**}`.
- **Negated constraints** (`!`) keep their exclusion semantics.

| Constraint | Normalized to | Meaning |
|---|---|---|
| `src` | `src/**` | Only search in `src/` directory |
| `src/` | `src/**` | Same as above (trailing `/` stripped) |
| `src/**` | `src/**` | Same as above (already a glob) |
| `src/**/tests` | `src/**/tests/**` | Any `tests/` dir anywhere under `src/` |
| `*.ts` | `*.ts` | Only search `.ts` files |
| `*.{ts,tsx}` | `*.{ts,tsx}` | Only search `.ts` and `.tsx` files |
| `!test/` | `!test/**` | Exclude `test/` directory |
| `!*.min.js` | `!*.min.js` | Exclude minified JS files |
| `python pydantic` | `{python/**,pydantic/**}` | Under `python/` **or** `pydantic/` |
| `python pydantic !pydantic/**/api` | `{python/**,pydantic/**} !pydantic/**/api/**` | Under `python/` **or** `pydantic/`, but not `pydantic/api/` or `pydantic/foo/api/` |
| `src/ *.ts !test/` | `src/** *.ts !test/**` | Include `src/` and `*.ts`, exclude `test/` |
| `{python/**,pydantic/**}` | `{python/**,pydantic/**}` | Passed through unchanged |
| `./lib` | `lib/**` | Leading `./` is stripped |

## Daemon mode

If `fff-daemon` is running, `ffgrep` connects via Unix domain socket instead of creating its own `FileFinder`. The query is executed instantly against the warm in-memory index — no scan delay. Passing `--base` forces standalone (non-daemon) mode.

```bash
# Terminal 1
fff-daemon ~/projects/my-project # assumes /tmp/fff.sock default

# Terminal 2 — instant
ffgrep "TODO"                    # assumes /tmp/fff.sock default
```

If no daemon is listening, `ffgrep` falls back to local Standalone mode automatically (creates its own FileFinder, waits for scan). Control the socket path with `FFF_DAEMON_SOCK` or passing `--sock <path>` parameter.

## How it works

- Creates an FFF `FileFinder` for the base directory
- Waits for the initial file scan to complete
- Auto-detects regex vs literal mode (unless overridden)
- Respects smart case by default (case-insensitive when pattern is all lowercase)
- Results are ranked by **frecency** (frequency and recency, most-accessed files first)
- Matches within a file stay in source order
- Respects both `.gitignore` and `.ignore`

## Examples

### Basic search

```bash
ffgrep "registerCommand" --limit 5
```

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```
~/projects/my-project/extensions/emacs-org-cli.ts
 537: pi.registerCommand("org-cli-info", {

~/projects/my-project/extensions/exit-command.ts
  10: pi.registerCommand("exit", {

Matched 2 lines across 2731 files searched (2731 eligible)
```

### With context and constraints

```bash
ffgrep "registerTool" --constraints "extensions/emacs-org-cli.ts" --context 2 --limit 5
```

Shows matches with 2 lines of surrounding (before and after) context in the specified file.

```bash
# Show 3 lines before and 1 line after each match
ffgrep "TODO" --before-context 3 --after-context 1
```

### Search outside the base directory (may not be indexed, depending on Daemon mode)

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
ffgrep "TypeDecorator" \
  --base ~/.pi/agent/.local/share/devdocs \
  --constraints "sqlalchemy" \
  --limit 5
```

### Regex mode with constraints

```bash
ffgrep "^import" --constraints "extensions" --regex --limit 5
```

### Include and exclude together

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

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

Each unique `pattern|constraints|limit|pageSize` gets its own cursor namespace — changing
either key restarts pagination at page 1.

Cursor state is stored in `${FFF_CURSORS_DIR:-~/.local/cache/fff/cursors}/ffgrep-cursors.json` and
expires after 24 hours or when the store exceeds 200 entries.

## Safety features

- **Wildcard guard**: Patterns like `.*`, `.*?`, `.+` are rejected with an error because they match everything
- **Regex fallback**: If `--regex` is used with an invalid regex, the engine falls back to literal matching and reports the compilation error
- **Smart case**: Case-insensitive when the pattern is all lowercase, case-sensitive otherwise (override with `--ignore-case`)
