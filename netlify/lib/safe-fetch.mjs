// Hardened HTTP GET used by every server-side fetch in this project.
//
// Why a custom client instead of fetch()?
//  - We must stop SSRF: a user-supplied URL must never reach localhost, cloud
//    metadata endpoints or private networks. The check is done inside the DNS
//    lookup used for the actual connection, so DNS rebinding can't bypass it.
//  - We need hard caps on download size (including after decompression), time
//    and redirects, because this runs on a public serverless endpoint.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

export const MAX_BYTES = 3 * 1024 * 1024;
export const TIMEOUT_MS = 9000;
export const MAX_REDIRECTS = 4;

export function userAgent() {
  const contact = process.env.CONTACT_URL ? ` (+${process.env.CONTACT_URL})` : '';
  return process.env.USER_AGENT || `MyInternetReader/1.0 (personal feed reader)${contact}`;
}

export class FetchError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'FetchError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// ---- address filtering -----------------------------------------------------

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['64:ff9b::', 96], ['100::', 64],
]) blocked.addSubnet(addr, prefix, 'ipv6');

export function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (!v) return true;
  if (v === 6) {
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1
    const m = ip.toLowerCase().match(/^(?:0{0,4}:){0,5}ffff:(.+)$/);
    if (m) {
      const tail = m[1];
      if (net.isIPv4(tail)) return blocked.check(tail, 'ipv4');
      const parts = tail.split(':');
      if (parts.length === 2) {
        const n = (parseInt(parts[0], 16) << 16) | parseInt(parts[1], 16);
        const v4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
        return blocked.check(v4, 'ipv4');
      }
      return true;
    }
    return blocked.check(ip, 'ipv6');
  }
  return blocked.check(ip, 'ipv4');
}

function allowPrivate() {
  // Test-only escape hatch so the test-suite can talk to localhost fixtures.
  return process.env.ALLOW_PRIVATE_HOSTS === '1';
}

export function parseHttpUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new FetchError('invalid_url', 'That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('invalid_url', 'Only http(s) URLs are supported.');
  }
  if (url.username || url.password) {
    throw new FetchError('invalid_url', 'URLs with embedded credentials are not allowed.');
  }
  if (url.port && !['80', '443'].includes(url.port) && !allowPrivate()) {
    throw new FetchError('invalid_url', 'Only the default web ports (80/443) are allowed.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !allowPrivate() && isBlockedIp(host)) {
    throw new FetchError('blocked_address', 'That address is not allowed.');
  }
  if (!allowPrivate() && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))) {
    throw new FetchError('blocked_address', 'That address is not allowed.');
  }
  return url;
}

function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = allowPrivate() ? addrs : addrs.filter((a) => !isBlockedIp(a.address));
    if (!ok.length) {
      return cb(new FetchError('blocked_address', 'That address is not allowed.'));
    }
    if (options && options.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

// ---- single request --------------------------------------------------------

function requestOnce(url, { accept, maxBytes, timeoutMs, headers }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };

    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        agent: false,
        headers: {
          'User-Agent': userAgent(),
          Accept: accept || '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const base = { status, headers: res.headers, url: url.href };

        // Redirects: don't read the body.
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return done(resolve, { ...base, body: Buffer.alloc(0) });
        }

        let stream = res;
        const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
        try {
          if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
          else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
          else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        } catch (e) {
          return done(reject, new FetchError('bad_encoding', 'Could not decode the response.'));
        }

        const chunks = [];
        let total = 0;
        stream.on('data', (c) => {
          total += c.length;
          if (total > maxBytes) {
            req.destroy();
            res.destroy();
            return done(reject, new FetchError('too_large', 'The response was too large.'));
          }
          chunks.push(c);
        });
        stream.on('end', () => done(resolve, { ...base, body: Buffer.concat(chunks) }));
        stream.on('error', () => done(reject, new FetchError('bad_encoding', 'Could not decode the response.')));
        res.on('error', (e) => done(reject, wrap(e)));
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      done(reject, new FetchError('timeout', 'The site took too long to respond.'));
    }, timeoutMs);

    req.on('error', (e) => done(reject, wrap(e)));
    req.end();
  });
}

function wrap(e) {
  if (e instanceof FetchError) return e;
  if (e && (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN')) {
    return new FetchError('dns', 'Could not find that site.');
  }
  if (e && e.code === 'ECONNREFUSED') return new FetchError('connect', 'The site refused the connection.');
  if (e && e.code === 'ECONNRESET') return new FetchError('connect', 'The connection was reset.');
  if (e && /certificate|SSL|TLS|self.signed|CERT_/i.test(String(e.code) + String(e.message))) {
    return new FetchError('tls', 'The site has an invalid security certificate.');
  }
  return new FetchError('network', 'Could not connect to that site.');
}

// ---- public API ------------------------------------------------------------

export async function safeGet(input, opts = {}) {
  const options = {
    accept: opts.accept,
    maxBytes: opts.maxBytes ?? MAX_BYTES,
    timeoutMs: opts.timeoutMs ?? TIMEOUT_MS,
    headers: opts.headers || {},
  };
  const deadline = Date.now() + options.timeoutMs;
  let url = parseHttpUrl(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = Math.max(1000, deadline - Date.now());
    const res = await requestOnce(url, { ...options, timeoutMs: remaining });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      let next;
      try { next = new URL(res.headers.location, url); } catch {
        throw new FetchError('bad_redirect', 'The site sent an invalid redirect.');
      }
      url = parseHttpUrl(next.href); // re-validate every hop
      continue;
    }
    return res;
  }
  throw new FetchError('too_many_redirects', 'The site redirected too many times.');
}

export function decodeBody(buf, contentType = '') {
  let charset = (/charset=([^\s;]+)/i.exec(contentType) || [])[1];
  if (!charset) {
    const head = buf.subarray(0, 300).toString('latin1');
    charset = (/<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(head) || [])[1];
  }
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  charset = (charset || 'utf-8').replace(/['"]/g, '').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}
