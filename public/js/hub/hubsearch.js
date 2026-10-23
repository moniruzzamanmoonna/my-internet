// Search across everything on the dashboard (not the RSS feed; the header search does that).
// Plain substring matching on every word; results keep the order of the index, grouped by
// section. There is no scoring, personalisation or engagement signal. DOM-free.

export function buildIndex(parts) {
  const idx = [];
  const add = (type, title, text, route, extra = {}) => idx.push({ type, title: String(title || ''), text: String(text || ''), route, ...extra });
  for (const it of parts.fun || []) add(it.type === 'podcast' || it.type === 'video' ? 'Podcasts & video' : it.type === 'movie' ? 'Movies' : it.type === 'documentary' ? 'Documentaries' : 'Music', it.title, `${it.by || ''} ${it.blurb || ''}`, '#/entertainment');
  for (const f of parts.facts || []) add('Fact', f.t.slice(0, 80), f.t, '#/entertainment/facts');
  for (const r of parts.riddles || []) add('Riddle', r.q.slice(0, 80), `${r.q}`, '#/entertainment/facts');
  for (const w of parts.vocab || []) add('Word', w.w, `${w.bn} ${w.ex}`, '#/learn/vocab');
  for (const q of parts.quizzes || []) add('Quiz question', q.q, q.explain, '#/learn/quiz');
  for (const d of parts.destinations || []) add('Destination', d.name, `${d.division} ${d.blurb}`, '#/bangladesh/explore');
  for (const div of parts.divisions || []) {
    add('Division', div.name, `${div.bn} ${div.districts.join(' ')}`, '#/bangladesh/explore');
    for (const d of div.districts) add('District', d, div.name, '#/bangladesh/explore');
  }
  for (const s of parts.services || []) add('Public service', s.name, s.desc || '', '#/bangladesh/services');
  for (const e of parts.emergency || []) add('Emergency number', `${e.number} — ${e.name}`, '', '#/bangladesh/services');
  for (const h of parts.history || []) add('History', h.title, h.text, '#/bangladesh/history');
  for (const c of parts.culture || []) add('Culture', c.title, c.text, '#/bangladesh/history');
  for (const l of parts.links || []) add('Quick link', l.title, l.url, '#/home');
  for (const g of parts.goals || []) add('Goal', g.t, '', '#/home');
  for (const r of parts.reading || []) add('Reading list', r.title, r.url || '', '#/learn/reading');
  for (const c of parts.checklist || []) add('Checklist', c.t, '', '#/learn/checklist');
  return idx;
}

export function searchIndex(index, q, limit = 30) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const e of index) {
    const hay = `${e.title} ${e.text}`.toLowerCase();
    if (terms.every((t) => hay.includes(t))) out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
