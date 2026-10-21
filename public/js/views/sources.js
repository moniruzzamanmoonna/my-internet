import { h, sourceId, hostOf, timeAgo } from '../util.js';
import { previewFeed } from '../api.js';

const NEW_CAT = '__new__';

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildOpml(sources, ctx) {
  const byCat = new Map();
  for (const s of sources) {
    const k = ctx.catName(s.cat);
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(s);
  }
  const body = [...byCat].map(([cat, list]) => `    <outline text="${esc(cat)}" title="${esc(cat)}">\n${list.map((s) =>
    `      <outline type="rss" text="${esc(s.name)}" title="${esc(s.name)}" xmlUrl="${esc(s.url)}"/>`).join('\n')}\n    </outline>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>My Internet sources</title></head>\n  <body>\n${body}\n  </body>\n</opml>\n`;
}

export function parseOpml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('That file is not valid OPML.');
  const out = [];
  const walk = (node, cat) => {
    for (const o of node.children) {
      if (o.tagName.toLowerCase() !== 'outline') continue;
      const xml = o.getAttribute('xmlUrl');
      const label = o.getAttribute('title') || o.getAttribute('text') || '';
      if (xml) out.push({ url: xml, name: label || hostOf(xml), cat: cat || 'Imported' });
      else walk(o, label || cat);
    }
  };
  const body = doc.querySelector('body');
  if (body) walk(body, '');
  return out.filter((s) => /^https?:\/\//i.test(s.url)).slice(0, 200);
}

export function renderSources(ctx, root) {
  const { store, feeds, catalog } = ctx;

  // ---------- add form ----------
  const url = h('input', { type: 'text', id: 'add-url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'example.com or https://example.com/feed.xml', required: true });
  const name = h('input', { type: 'text', id: 'add-name', placeholder: 'Optional — defaults to the feed’s title', maxlength: '80' });
  const catSel = h('select', { id: 'add-cat' },
    ...catalog.categories.map((c) => h('option', { value: c.id, text: c.name })),
    h('option', { value: NEW_CAT, text: 'New category…' }));
  const newCat = h('input', { type: 'text', id: 'add-newcat', placeholder: 'Category name', maxlength: '30', hidden: true });
  catSel.addEventListener('change', () => { newCat.hidden = catSel.value !== NEW_CAT; if (!newCat.hidden) newCat.focus(); });
  const msg = h('p', { class: 'form-msg', role: 'status', 'aria-live': 'polite' });
  const found = h('div', { class: 'found' });
  const addBtn = h('button', { type: 'submit', class: 'btn primary', text: 'Add source' });

  function chosenCategory() {
    if (catSel.value !== NEW_CAT) return catSel.value;
    const typed = newCat.value.trim().replace(/\s+/g, ' ');
    if (!typed) return null;
    const known = catalog.categories.find((c) => c.name.toLowerCase() === typed.toLowerCase());
    return known ? known.id : typed;
  }

  async function addUrl(raw) {
    let target = raw.trim();
    if (!target) return;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) target = `https://${target}`;
    const cat = chosenCategory();
    if (!cat) { msg.textContent = 'Please name the new category.'; msg.className = 'form-msg err'; return; }
    msg.className = 'form-msg'; msg.textContent = 'Checking that address…'; found.replaceChildren();
    addBtn.disabled = true;
    try {
      const r = await previewFeed(target);
      const id = sourceId(target);
      const existing = store.getSource(id);
      store.upsertSource(id, {
        url: target, name: name.value.trim() || r.feed.title || hostOf(target), cat: existing ? existing.cat : cat, on: 1, kind: existing ? existing.kind : 'custom',
      });
      msg.textContent = `Added “${name.value.trim() || r.feed.title || hostOf(target)}” (${r.items.length} articles found).`;
      msg.className = 'form-msg ok';
      url.value = ''; name.value = '';
      feeds.refresh({ only: [id], force: true });
      renderLists();
    } catch (e) {
      msg.className = 'form-msg err';
      msg.textContent = e.message || 'Could not add that source.';
      if (e.discovered && e.discovered.length) {
        found.replaceChildren(h('p', { text: 'Feeds found on that page:' }), ...e.discovered.map((d) =>
          h('button', { type: 'button', class: 'btn', onclick: () => { url.value = d.url; if (d.title && !name.value) name.value = d.title; addUrl(d.url); } }, d.title || d.url)));
      }
    } finally { addBtn.disabled = false; }
  }

  const form = h('form', { class: 'panel add-form', onsubmit: (e) => { e.preventDefault(); addUrl(url.value); } },
    h('h2', { text: 'Add a website or feed' }),
    h('p', { class: 'hint', text: 'Paste a feed address, or just a website — if it publishes an official RSS/Atom feed we’ll find it. Sites without a feed can’t be added: this app never scrapes pages.' }),
    h('label', { for: 'add-url', text: 'Website or feed address' }), url,
    h('div', { class: 'row' },
      h('div', {}, h('label', { for: 'add-name', text: 'Name' }), name),
      h('div', {}, h('label', { for: 'add-cat', text: 'Category' }), catSel, newCat)),
    addBtn, msg, found);

  // ---------- lists ----------
  const mine = h('section', { class: 'panel' });
  const browse = h('section', { class: 'panel' });

  function statusLine(s) {
    const st = feeds.status.get(s.id);
    if (!s.on) return h('span', { class: 'pill', text: 'Paused' });
    if (!st || st.state === 'loading') return h('span', { class: 'pill', text: 'Loading…' });
    if (st.state === 'error') {
      return h('span', { class: 'pill bad', title: st.message },
        `${st.message}${st.stale ? ' Showing older articles.' : ''}`);
    }
    const res = feeds.results.get(s.id);
    return h('span', { class: 'pill good', text: `${st.count} articles${res && res.fetchedAt ? ` · ${timeAgo(new Date(res.fetchedAt).toISOString())}` : ''}` });
  }

  function renderMine() {
    const list = store.sources().filter((s) => s.on || s.kind === 'custom')
      .sort((a, b) => ctx.catName(a.cat).localeCompare(ctx.catName(b.cat)) || a.name.localeCompare(b.name));
    const failed = list.filter((s) => s.on && feeds.status.get(s.id)?.state === 'error');
    mine.replaceChildren(...[
      h('div', { class: 'panel-head' },
        h('h2', { text: `Your sources (${list.filter((s) => s.on).length} active)` }),
        h('button', { type: 'button', class: 'btn', onclick: () => { feeds.refresh({ force: true }); ctx.toast('Refreshing all sources…'); } }, 'Refresh all')),
      failed.length ? h('p', { class: 'hint warn-text', text: `${failed.length} source${failed.length > 1 ? 's are' : ' is'} failing. Publishers sometimes move or retire feeds — retry, or remove what no longer works.` }) : null,
      list.length ? h('ul', { class: 'src-list' }, list.map((s) => h('li', { class: 'src' },
        h('div', { class: 'src-main' },
          h('strong', { text: s.name }),
          h('span', { class: 'host', text: hostOf(s.url) }),
          statusLine(s)),
        h('div', { class: 'src-actions' },
          h('select', { 'aria-label': `Category for ${s.name}`, onchange: (e) => { store.upsertSource(s.id, { cat: e.target.value }); renderLists(); } },
            ...ctx.allCategories().map((c) => h('option', { value: c.id, text: c.name, selected: c.id === s.cat }))),
          h('button', { type: 'button', class: 'btn sm', onclick: () => { feeds.refresh({ only: [s.id], force: true }); } }, 'Retry'),
          h('button', { type: 'button', class: 'btn sm danger', onclick: () => {
            if (s.kind === 'custom') store.removeSource(s.id); else store.upsertSource(s.id, { on: 0 });
            ctx.toast(`Removed ${s.name}`); renderLists();
          } }, 'Remove'))))) : h('p', { class: 'hint', text: 'No sources yet. Add one above or switch some on below.' }),
    ].filter(Boolean));
  }

  function renderBrowse() {
    browse.replaceChildren(
      h('div', { class: 'panel-head' },
        h('h2', { text: 'Suggested sources' }),
        h('button', { type: 'button', class: 'btn', onclick: () => enableStarter() }, 'Enable starter set')),
      h('p', { class: 'hint', text: 'Official publisher feeds. Switch on only what you want; none are ranked or promoted.' }),
      ...catalog.categories.map((c) => h('details', { class: 'cat-group', open: store.sources().some((s) => s.on && s.cat === c.id) },
        h('summary', { text: c.name }),
        h('ul', { class: 'src-list' }, catalog.sources.filter((s) => s.cat === c.id).map((s) => {
          const id = sourceId(s.url);
          const rec = store.getSource(id);
          return h('li', { class: 'src' },
            h('div', { class: 'src-main' }, h('strong', { text: s.name }), h('span', { class: 'host', text: s.blurb || hostOf(s.url) })),
            h('label', { class: 'switch' },
              h('input', { type: 'checkbox', checked: !!(rec && rec.on), 'aria-label': `Follow ${s.name}`, onchange: (e) => toggleCatalog(s, e.target.checked) }),
              h('span', { class: 'sr', text: 'Follow' })));
        })))));
  }

  function toggleCatalog(s, on) {
    const id = sourceId(s.url);
    const rec = store.getSource(id);
    store.upsertSource(id, { url: s.url, name: rec ? rec.name : s.name, cat: rec ? rec.cat : s.cat, on: on ? 1 : 0, kind: rec ? rec.kind : 'catalog' });
    if (on) feeds.refresh({ only: [id] });
    renderMine();
  }

  function enableStarter() {
    const ids = [];
    for (const s of catalog.sources.filter((x) => x.starter)) {
      const id = sourceId(s.url);
      const rec = store.getSource(id);
      if (!rec || !rec.on) store.upsertSource(id, { url: s.url, name: s.name, cat: s.cat, on: 1, kind: 'catalog' });
      ids.push(id);
    }
    feeds.refresh({ only: ids });
    ctx.toast('Starter sources enabled');
    renderLists();
  }

  // ---------- data & backup ----------
  const importFile = h('input', { type: 'file', accept: '.json,.opml,.xml,application/json,text/xml', hidden: true });
  importFile.addEventListener('change', async () => {
    const f = importFile.files[0]; importFile.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      if (/\.json$/i.test(f.name)) {
        ctx.store.importJSON(text);
        ctx.toast('Backup imported');
      } else {
        const list = parseOpml(text);
        if (!list.length) throw new Error('No feeds were found in that file.');
        for (const s of list) {
          const id = sourceId(s.url);
          if (!store.getSource(id)) store.upsertSource(id, { url: s.url, name: s.name, cat: s.cat, on: 1, kind: 'custom' });
        }
        feeds.refresh();
        ctx.toast(`Imported ${list.length} feeds`);
      }
      renderLists();
    } catch (e) { ctx.toast(e.message || 'Import failed', { kind: 'error' }); }
  });

  const backup = h('section', { class: 'panel' },
    h('h2', { text: 'Your data' }),
    h('p', { class: 'hint', text: ctx.syncEnabled
      ? 'Sign in (top right) to sync sources, bookmarks, notes and read status across devices. Otherwise everything stays in this browser.'
      : 'Everything is stored in this browser only. Export a backup now and then, or enable Firebase sync (see the README).' }),
    h('div', { class: 'row-btns' },
      h('button', { type: 'button', class: 'btn', onclick: () => download('my-internet-backup.json', store.exportJSON(), 'application/json') }, 'Export backup (JSON)'),
      h('button', { type: 'button', class: 'btn', onclick: () => download('my-internet-sources.opml', buildOpml(store.sources().filter((s) => s.on), ctx), 'text/x-opml') }, 'Export sources (OPML)'),
      h('button', { type: 'button', class: 'btn', onclick: () => importFile.click() }, 'Import backup or OPML…')),
    importFile);

  function renderLists() { renderMine(); renderBrowse(); }
  root.append(h('h1', { class: 'page-title', text: 'Sources' }), form, mine, browse, backup);
  renderLists();
  const unsub = feeds.subscribe(renderMine);
  return unsub;
}
