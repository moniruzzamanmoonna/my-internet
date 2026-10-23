// Gentle browsing-session reminder: you choose a length, and when it ends a calm dialog
// suggests stepping away. No sound, no streaks, no guilt, and you can always dismiss it.
import { h } from '../util.js';
import { createTimer, formatClock } from './timer.js';

export function createSession({ storage, toast }) {
  const timer = createTimer({ storage, key: 'mi.session.v1' });
  const btn = document.getElementById('btn-session');
  const dlg = document.getElementById('session-dialog');
  let lastLabel = '';

  function close() { if (dlg.open) dlg.close(); }

  function openPicker() {
    const s = timer.status();
    const custom = h('input', { type: 'number', min: '1', max: '240', value: '20', 'aria-label': 'Custom minutes', class: 'num-in' });
    const start = (m) => { timer.start(m); toast(`Session set for ${m} minutes. I’ll remind you when it ends.`); close(); tick(); };
    dlg.replaceChildren(
      h('h2', { text: 'Browsing time' }),
      h('p', { text: 'How long do you want to spend here? When the time is up you’ll get a gentle reminder: nothing is locked or hidden.' }),
      s.state === 'running' ? h('p', { class: 'hint', text: `A ${s.mins}-minute session is running (${formatClock(s.remainingMs)} left).` }) : null,
      h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Session length' }, [10, 15, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip', onclick: () => start(m) }, `${m} min`))),
      h('div', { class: 'inline-form' }, custom, h('button', { type: 'button', class: 'btn sm', onclick: () => start(Math.min(240, Math.max(1, Number(custom.value) || 20))) }, 'Start')),
      h('div', { class: 'row-btns' },
        s.state === 'running' ? h('button', { type: 'button', class: 'btn', onclick: () => { timer.reset(); toast('Session cleared'); close(); tick(); } }, 'Clear session') : null,
        h('button', { type: 'button', class: 'btn', onclick: close }, 'Close')));
    if (!dlg.open) dlg.showModal();
  }

  function showDone(mins) {
    dlg.replaceChildren(
      h('h2', { text: 'Your time is up' }),
      h('p', { text: `Your ${mins}-minute session has ended. This is a good moment to step away: stretch, drink some water, or look at something far away.` }),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => { timer.reset(); close(); tick(); } }, 'I’m done for now'),
        h('button', { type: 'button', class: 'btn', onclick: () => { timer.extend(5); close(); tick(); } }, '5 more minutes')));
    if (!dlg.open) dlg.showModal();
    document.title = '⏳ Time is up · My Internet';
    dlg.addEventListener('close', () => { document.title = document.title.replace('⏳ Time is up · ', ''); }, { once: true });
  }

  function tick() {
    const s = timer.status();
    const label = s.state === 'running' || s.state === 'paused' ? `⏳ ${formatClock(s.remainingMs)}` : '⏳';
    if (label !== lastLabel) { btn.textContent = label; lastLabel = label; }
    btn.classList.toggle('active', s.state === 'running');
    if (s.state === 'done') { timer.acknowledge(); showDone(s.mins); }
  }

  btn.addEventListener('click', openPicker);
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);
  tick();
  return { open: openPicker };
}
