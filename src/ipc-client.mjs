/**
 * IPC client for fff-daemon.  Tries to connect to the Unix domain socket,
 * falls back to local FileFinder creation if the daemon is not running.
 */

import net from 'node:net';

export function ipcAvailable() {
  return new Promise((resolve) => {
    const sock = net.connect({ path: getSockPath() });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.setTimeout(200, () => { try { sock.destroy(); } catch {} resolve(false); });
  });
}

let _sockPathOverride = null;

export function setSockPath(path) {
  _sockPathOverride = path;
}

export function getSockPath() {
  return _sockPathOverride || process.env.FFF_DAEMON_SOCK || '/tmp/fff.sock';
}

export function dslRequest(op, params) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ path: getSockPath() });
    let buf = '';
    let done = false;

    sock.setEncoding('utf8');
    sock.setTimeout(30000);

    function finish(err, result) {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      if (err) reject(err); else resolve(result);
    }

    sock.on('connect', () => {
      sock.write(JSON.stringify({ op, params }) + '\n');
    });

    sock.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        const line = buf.slice(0, nl);
        try {
          const response = JSON.parse(line);
          if (!response.ok) finish(new Error(response.error || 'daemon error'));
          else finish(null, response.result);
        } catch (e) {
          finish(new Error(`Invalid daemon response: ${e.message}`));
        }
      }
    });

    sock.on('error', (e) => finish(e));
    sock.on('timeout', () => finish(new Error('Daemon timeout')));
    sock.on('close', () => {
      if (!done && !buf.includes('\n')) finish(new Error('Daemon closed without response'));
    });
  });
}

export function dslFind(query, pageIndex = 0, pageSize = 30) {
  return dslRequest('find', { query, pageIndex, pageSize });
}

export function dslGrep(query, opts = {}) {
  return dslRequest('grep', {
    query,
    mode: opts.mode || 'plain',
    smartCase: opts.smartCase !== false,
    maxMatchesPerFile: Math.min(Math.max(1, opts.limit || 50), 100),
    pageSize: opts.pageSize || 0,
    cursorRaw: opts.cursorRaw || null,
    beforeContext: opts.beforeContext || 0,
    afterContext: opts.afterContext || 0,
  });
}

export function dslMultiGrep(patterns, opts = {}) {
  return dslRequest('multi-grep', {
    patterns,
    constraints: opts.constraints || null,
    maxMatchesPerFile: Math.min(Math.max(1, opts.limit || 50), 100),
    pageSize: opts.pageSize || 0,
    smartCase: opts.smartCase !== false,
    cursorRaw: opts.cursorRaw || null,
    beforeContext: opts.beforeContext || 0,
    afterContext: opts.afterContext || 0,
  });
}

export function dslHealth() {
  return dslRequest('health', {});
}

export function dslScan() {
  return dslRequest('scan', {});
}
