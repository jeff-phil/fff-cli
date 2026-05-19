/**
 * Shared constraint normalization for fff-cli tools.
 *
 * Parses a space-separated constraint string, respecting brace groups {...}.
 * Strips leading `./` from paths, expands bare directory names to `/**`,
 * preserves existing globs/extensions/brace groups.
 * Groups consecutive bare-dir constraints into `{a/**,b/**}` form.
 */

export function normalizeConstraints(constraints) {
  if (!constraints) return undefined;
  const tokens = tokenize(constraints);
  const normalized = [];

  for (const token of tokens) {
    const isNegated = token.startsWith('!');
    const raw = isNegated ? token.slice(1) : token;

    if (isBraceGroup(raw)) {
      const inner = raw.slice(1, -1);
      const items = inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const normItems = items.map(normalizePath).filter(Boolean);
      if (normItems.length > 0) {
        normalized.push(
          isNegated ? `!{${normItems.join(',')}}` : `{${normItems.join(',')}}`,
        );
      }
    } else {
      const n = normalizePath(raw);
      if (n) normalized.push(isNegated ? `!${n}` : n);
    }
  }

  if (normalized.length === 0) return undefined;
  return groupBareDirs(normalized).join(' ');
}

// Split on whitespace, but NOT inside {...}
function tokenize(constraints) {
  const tokens = [];
  let current = '';
  let braceDepth = 0;

  for (const char of constraints) {
    if (char === '{') {
      braceDepth++;
      current += char;
    } else if (char === '}') {
      braceDepth--;
      current += char;
    } else if (/\s/.test(char) && braceDepth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function isBraceGroup(s) {
  return s.startsWith('{') && s.endsWith('}') && s.length > 2;
}

function normalizePath(s) {
  let t = s.trim();
  if (!t || t === '.' || t === './') return null;
  if (t.startsWith('./')) t = t.slice(2);

  // Strip trailing slashes (and optional single trailing *) to inspect last segment
  const stripped = t.replace(/\/+(\*)?$/, '');
  const last = stripped.split('/').pop() ?? '';
  if (!needsDirGlob(last)) return t;
  return `${stripped}/**`;
}

function needsDirGlob(segment) {
  if (!segment || /[.*?[{]/.test(segment)) return false;
  if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(segment)) return false;
  return true;
}

// Group consecutive bare-dir constraints into a single brace group.
// Example: ['python/**', 'pydantic/**', '!*.min.js'] → ['{python/**,pydantic/**}', '!*.min.js']
function groupBareDirs(normalized) {
  const result = [];
  let group = [];

  for (const item of normalized) {
    const isBareDir =
      !item.startsWith('!') &&
      item.endsWith('/**') &&
      !item.includes('{') &&
      !item.includes(',');
    if (isBareDir) {
      group.push(item);
    } else {
      flushGroup(result, group);
      group = [];
      result.push(item);
    }
  }
  flushGroup(result, group);
  return result;

  function flushGroup(res, grp) {
    if (grp.length > 1) {
      res.push(`{${grp.join(',')}}`);
    } else if (grp.length === 1) {
      res.push(grp[0]);
    }
  }
}
