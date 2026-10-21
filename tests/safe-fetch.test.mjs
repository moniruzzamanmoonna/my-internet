import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHttpUrl, isBlockedIp, safeGet, FetchError } from '../netlify/lib/safe-fetch.mjs';

test('private, loopback, link-local and metadata addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '100.64.0.1']) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.equal(isBlockedIp(ip), false, ip);
});

test('URL validation rejects bad schemes, credentials, odd ports and local names', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://x.test/', 'http://user:pw@x.test/', 'http://x.test:8080/', 'http://localhost/', 'http://foo.internal/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'not a url']) {
    assert.throws(() => parseHttpUrl(bad), FetchError, bad);
  }
  assert.doesNotThrow(() => parseHttpUrl('https://example.com/feed.xml'));
});

test('safeGet refuses to connect to loopback', async () => {
  await assert.rejects(() => safeGet('http://127.0.0.1/'), (e) => e instanceof FetchError && e.code === 'blocked_address');
});
