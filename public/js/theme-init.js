// Runs before first paint to avoid a light/dark flash.
try {
  const t = JSON.parse(localStorage.getItem('mi.theme') || 'null');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* storage blocked: fall back to system */ }
