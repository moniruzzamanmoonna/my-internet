import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyJob, matchesPrefs, normalisePrefs, parseKeywords, pickFresh, DEFAULT_PREFS } from '../public/js/hub/jobs.js';
import { createJobWatch } from '../public/js/hub/jobwatch.js';

const it = (title, extra = {}) => ({ id: title.slice(0, 12).replace(/\W/g, 'x') + 'abcdef', title, summary: '', link: 'https://e.x/' + title.length, published: new Date().toISOString(), ...extra });

test('classify: circular vs general job news', () => {
  assert.equal(classifyJob(it('BPSC to recruit 76 officials')).circular, true);
  assert.equal(classifyJob(it('Ministry invites applications: vacancies for teachers')).circular, true);
  assert.equal(classifyJob(it('শিক্ষক নিয়োগ বিজ্ঞপ্তি প্রকাশ')).circular, true);
  const n = classifyJob(it('Unemployment rises among graduates'));
  assert.equal(n.circular, false); assert.equal(n.jobish, true);
  assert.equal(classifyJob(it('Cricket team wins')).jobish, false);
  assert.equal(classifyJob(it('anything', { cat: 'jobs' })).circular, true, 'items from your own jobs feeds count as circulars');
});

test('classify: sector and fields are guessed, and unknown stays unknown', () => {
  assert.equal(classifyJob(it('Ministry of Health recruits 500 doctors')).sector, 'govt');
  assert.equal(classifyJob(it('BRAC NGO hiring field officers')).sector, 'private');
  assert.equal(classifyJob(it('Company hiring and Ministry partner recruitment')).sector, 'unknown');
  assert.equal(classifyJob(it('Recruitment of nurses')).sector, 'unknown');
  assert.ok(classifyJob(it('Hospital recruits nurses and doctors')).fields.includes('health'));
});

test('matchesPrefs: sector, fields, keywords', () => {
  const govt = it('Ministry of Education recruits 100 teachers');
  const priv = it('Software company hiring developers, limited seats');
  assert.equal(matchesPrefs(govt, DEFAULT_PREFS), true);
  assert.equal(matchesPrefs(it('Football match tonight'), DEFAULT_PREFS), false, 'not a circular');
  assert.equal(matchesPrefs(priv, { ...DEFAULT_PREFS, sector: 'govt' }), false);
  assert.equal(matchesPrefs(govt, { ...DEFAULT_PREFS, sector: 'private' }), false);
  assert.equal(matchesPrefs(govt, { ...DEFAULT_PREFS, fields: ['teaching'] }), true);
  assert.equal(matchesPrefs(govt, { ...DEFAULT_PREFS, fields: ['it'] }), false);
  assert.equal(matchesPrefs(govt, { ...DEFAULT_PREFS, keywords: ['TEACHERS'] }), true);
  assert.equal(matchesPrefs(govt, { ...DEFAULT_PREFS, fields: ['it'], keywords: ['teachers'] }), true, 'fields OR keywords');
});

test('prefs normalise and keyword parsing', () => {
  assert.deepEqual(normalisePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalisePrefs('not json'), DEFAULT_PREFS);
  const p = normalisePrefs(JSON.stringify({ sector: 'x', fields: ['it', 'bogus'], keywords: [' a ', ''], notify: 1 }));
  assert.deepEqual(p, { sector: 'any', fields: ['it'], keywords: ['a'], notify: true });
  assert.deepEqual(parseKeywords('teacher, শিক্ষক،teacher\n'), ['teacher', 'শিক্ষক']);
});

test('pickFresh: only new, matching, unannounced items', () => {
  const now = Date.now();
  const a = it('BPSC recruits officers', { published: new Date(now).toISOString() });
  const old = it('Ministry vacancies announced long ago', { published: new Date(now - 864e5).toISOString() });
  const r = pickFresh([a, old], DEFAULT_PREFS, [], now - 3600e3);
  assert.deepEqual(r.fresh.map((x) => x.id), [a.id]);
  assert.deepEqual(pickFresh([a], DEFAULT_PREFS, r.announced, now - 3600e3).fresh, [], 'never announced twice');
});

test('watcher: first run announces nothing, later runs notify once', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  let t = 1000; const sent = [];
  const fresh = it('BPSC recruits 10 officers', { published: new Date(2000).toISOString() });
  const w = createJobWatch({ storage, now: () => t, getPrefs: () => ({ ...DEFAULT_PREFS, notify: true }), load: async () => [fresh], notify: (title) => sent.push(title) });
  await w.check(); assert.equal(sent.length, 0, 'enabling must not flood');
  t = 3000; await w.check(); assert.equal(sent.length, 1);
  t = 4000; await w.check(); assert.equal(sent.length, 1, 'no repeat');
  const off = createJobWatch({ storage, getPrefs: () => DEFAULT_PREFS, load: async () => { throw new Error('should not load'); }, notify: () => assert.fail() });
  assert.deepEqual(await off.check(), []);
});
