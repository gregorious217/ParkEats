const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function toast(message, kind = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function errorMessage(err) {
  const msg = err?.message || String(err);
  if (/20 miles/.test(msg)) return 'Restaurants must be within 20 miles of a California State Park.';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network problem. Check your connection and try again.';
  return msg;
}

export function showError(err) {
  console.error(err);
  toast(errorMessage(err), 'error', 6000);
}

// ---------- Side panel (bottom sheet on phones) ----------

const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
let onPanelClose = null;

export function openPanel(html, { onClose } = {}) {
  runPanelClose();
  onPanelClose = onClose || null;
  // A fresh container per view so listeners never pile up.
  const view = document.createElement('div');
  view.innerHTML = html;
  panelBody.replaceChildren(view);
  panel.hidden = false;
  panel.scrollTop = 0;
  return view;
}

export function closePanel() {
  runPanelClose();
  panel.hidden = true;
  panelBody.replaceChildren();
}

function runPanelClose() {
  const fn = onPanelClose;
  onPanelClose = null;
  if (fn) fn();
}

document.getElementById('panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden && !document.querySelector('.modal-backdrop:not([hidden])')) closePanel();
});

// ---------- Formatting ----------

export function timeAgo(iso) {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let value = secs;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-value, unit);
    value = Math.round(value / size);
  }
  return '';
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
