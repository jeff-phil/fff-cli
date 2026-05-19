/**
 * Shared grep output formatting for fff-cli tools.
 */

const GREP_MAX_LINE_LENGTH = 500;

export function truncateLine(line, max = GREP_MAX_LINE_LENGTH) {
  const t = line.trim();
  return t.length <= max ? t : `${t.slice(0, max)}...`;
}

export function fffFileAnnotation(item) {
  const g = item.gitStatus;
  return g && g !== 'clean' && g !== 'unknown' && g !== '' ? `  [${g} in git]` : '';
}

export function formatGrepOutput(result, basePath) {
  const root = result._basePath ?? basePath ?? '';
  const prefix = root ? root.replace(/\/$/, '') + '/' : '';
  if (!result.items || result.items.length === 0) return 'No matches found';
  const lines = [];
  let currentFile = '';
  for (const match of result.items) {
    if (match.relativePath !== currentFile) {
      if (lines.length > 0) lines.push('');
      currentFile = match.relativePath;
      lines.push(`${prefix}${currentFile}${fffFileAnnotation(match)}`);
    }
    match.contextBefore?.forEach((line, i) => {
      const ln = match.lineNumber - match.contextBefore.length + i;
      lines.push(` ${ln}- ${truncateLine(line)}`);
    });
    lines.push(` ${match.lineNumber}: ${truncateLine(match.lineContent)}`);
    match.contextAfter?.forEach((line, i) => {
      const ln = match.lineNumber + 1 + i;
      lines.push(` ${ln}- ${truncateLine(line)}`);
    });
  }
  return lines.join('\n');
}
