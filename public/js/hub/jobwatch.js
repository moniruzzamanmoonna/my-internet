// While My Internet is open, checks the job feeds now and then and shows a browser
// notification for new circulars that match the saved preferences.
// It does NOT run when the tab/app is closed (that needs a push server).
import { pickFresh } from './jobs.js';

const ANN_KEY = 'mi.jobann.v1';
const SINCE_KEY = 'mi.jobwatch.since.v1';

function read(storage, key, fallback) { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } }

export function createJobWatch({ storage, load, getPrefs, notify, now = Date.now, intervalMs = 30 * 60 * 1000, setTimer = setInterval, clearTimer = clearInterval }) {
  let timer = null; let busy = false;
  async function check() {
    const prefs = getPrefs();
    if (!prefs.notify || busy) return [];
    busy = true;
    try {
      const items = await load();
      // First run: remember "now" and announce nothing, so enabling notifications never floods.
      let since = read(storage, SINCE_KEY, null);
      if (since === null) { storage.setItem(SINCE_KEY, JSON.stringify(now())); return []; }
      const { fresh, announced } = pickFresh(items, prefs, read(storage, ANN_KEY, []), since);
      storage.setItem(ANN_KEY, JSON.stringify(announced));
      storage.setItem(SINCE_KEY, JSON.stringify(now()));
      const shown = fresh.slice(0, 3);
      shown.forEach((it) => notify(it.title, { body: `${it.sname || 'Job circular'} · matches your job preferences`, tag: it.id, data: { url: it.link } }));
      if (fresh.length > 3) notify(`${fresh.length - 3} more matching circulars`, { body: 'Open My Internet → Jobs to see them.', tag: 'mi-jobs-more' });
      return fresh;
    } catch { return []; } finally { busy = false; }
  }
  return {
    check,
    start() { if (!timer) { check(); timer = setTimer(check, intervalMs); } },
    stop() { if (timer) { clearTimer(timer); timer = null; } },
  };
}
