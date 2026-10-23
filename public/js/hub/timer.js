// A small persistent countdown used for the browsing-session reminder and the focus
// timer. It stores absolute end times, so it survives reloads and background tabs.
// DOM-free.

export function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function createTimer({ storage, key, now = () => Date.now() }) {
  const read = () => {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  };
  const write = (v) => {
    try { if (v) storage.setItem(key, JSON.stringify(v)); else storage.removeItem(key); } catch { /* storage blocked: timer works for this tab only */ }
  };
  let mem = read();
  const set = (v) => { mem = v; write(v); };

  return {
    start(mins) { set({ mins, endAt: now() + mins * 60000, pausedMs: null, ack: false }); },
    pause() { if (mem && mem.endAt) set({ ...mem, pausedMs: Math.max(0, mem.endAt - now()), endAt: null }); },
    resume() { if (mem && mem.pausedMs != null) set({ ...mem, endAt: now() + mem.pausedMs, pausedMs: null }); },
    extend(mins) { set({ mins, endAt: now() + mins * 60000, pausedMs: null, ack: false }); },
    reset() { set(null); },
    // Mark a finished timer as seen so the reminder is shown exactly once.
    acknowledge() { if (mem) set({ ...mem, ack: true }); },
    status() {
      if (!mem) return { state: 'idle', remainingMs: 0, mins: 0 };
      if (mem.pausedMs != null) return { state: 'paused', remainingMs: mem.pausedMs, mins: mem.mins };
      const left = mem.endAt - now();
      if (left <= 0) return { state: mem.ack ? 'idle-done' : 'done', remainingMs: 0, mins: mem.mins };
      return { state: 'running', remainingMs: left, mins: mem.mins };
    },
  };
}
