// Optional Firebase sync (Google sign-in + Firestore). Loaded ONLY when the server
// reports Firebase is configured, and only the first time it is needed.
// Layout: users/{uid}/state/{sources|library|reads|settings} = { data: {key: record}, updatedAt }
// Merging is last-writer-wins per record (see state.js), done inside a transaction
// so two devices writing at once cannot overwrite each other's additions.

import { NAMESPACES, compact } from './state.js';
import { debounce } from './util.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const DOC_BUDGET = 900_000; // bytes; Firestore's hard limit is 1 MiB per document

export function createSync({ store, config, onStatus }) {
  let fb = null;        // {app, auth, db, mods}
  let user = null;
  let unsubs = [];
  let applying = false;
  const dirty = new Set();

  const status = (s, detail = '') => onStatus && onStatus({ state: s, detail, user });

  async function load() {
    if (fb) return fb;
    const [appM, authM, fsM] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = appM.initializeApp(config);
    fb = { app, auth: authM.getAuth(app), db: fsM.getFirestore(app), authM, fsM };
    return fb;
  }

  const ref = (ns) => fb.fsM.doc(fb.db, 'users', user.uid, 'state', ns);

  async function pushNamespace(ns) {
    const { fsM, db } = fb;
    const r = ref(ns);
    let tooBig = false;
    await fsM.runTransaction(db, async (tx) => {
      const snap = await tx.get(r);
      const remote = snap.exists() ? (snap.data().data || {}) : {};
      const { map, changedRemote } = store.applyRemote(ns, remote);
      const out = compact(map, { max: ns === 'reads' ? 4000 : Infinity });
      if (JSON.stringify(out).length > DOC_BUDGET) { tooBig = true; return; }
      if (changedRemote || !snap.exists()) tx.set(r, { data: out, updatedAt: Date.now() });
    });
    if (tooBig) status('error', `Your ${ns} data is too large to sync. Remove some bookmarks or notes.`);
  }

  const flush = debounce(async () => {
    if (!user) return;
    const todo = [...dirty];
    dirty.clear();
    status('syncing');
    try {
      applying = true;
      for (const ns of todo) await pushNamespace(ns);
      status('synced');
    } catch (e) {
      todo.forEach((n) => dirty.add(n));
      status('error', 'Sync failed. Your data is safe on this device; will retry.');
    } finally { applying = false; }
  }, 1500);

  store.onLocalChange((ns) => {
    if (!user) return;
    if (ns === '*') NAMESPACES.forEach((n) => dirty.add(n)); else dirty.add(ns);
    flush();
  });

  async function startForUser(u) {
    user = u;
    status('syncing');
    try {
      applying = true;
      for (const ns of NAMESPACES) await pushNamespace(ns); // initial two-way merge
      unsubs = NAMESPACES.map((ns) => fb.fsM.onSnapshot(ref(ns), (snap) => {
        if (applying || !snap.exists() || snap.metadata.hasPendingWrites) return;
        store.applyRemote(ns, snap.data().data || {});
      }));
      status('synced');
    } catch (e) {
      status('error', 'Could not sync. Check your Firestore rules and that Firestore is enabled.');
    } finally { applying = false; }
  }

  return {
    async init() {
      status('loading');
      try {
        await load();
      } catch {
        status('error', 'Could not load Firebase (blocked network or content blocker?).');
        return;
      }
      fb.authM.onAuthStateChanged(fb.auth, (u) => {
        unsubs.forEach((f) => f()); unsubs = [];
        if (u) startForUser(u); else { user = null; status('signed-out'); }
      });
    },
    async signIn() {
      await load();
      const provider = new fb.authM.GoogleAuthProvider();
      try { await fb.authM.signInWithPopup(fb.auth, provider); }
      catch (e) {
        if (e && e.code === 'auth/popup-closed-by-user') return;
        status('error', e && e.code === 'auth/unauthorized-domain'
          ? 'This domain is not authorised in Firebase (Authentication → Settings → Authorized domains).'
          : 'Sign-in failed. Please try again.');
      }
    },
    async signOut() { if (fb) await fb.authM.signOut(fb.auth); },
    async getToken() { return fb && fb.auth.currentUser ? fb.auth.currentUser.getIdToken() : null; },
    get user() { return user; },
  };
}
