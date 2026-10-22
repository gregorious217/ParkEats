import { state } from './state.js';
import { esc } from './ui.js';

const DEFAULTS = { text: '', minUps: 0, minPct: 0, types: new Set(), submitter: '', park: '', followingOnly: false };
const f = { ...DEFAULTS, types: new Set() };

const root = document.getElementById('filters');
const toggleBtn = document.getElementById('btn-filters');
const badge = document.getElementById('filter-count');
let onApply = () => {};

export function initFilters(applyFn) {
  onApply = applyFn;
  root.innerHTML = `
    <div class="row spread"><h2>Filters</h2><button class="btn-link" id="flt-reset" type="button">Reset</button></div>

    <label for="flt-text">Name contains</label>
    <input id="flt-text" type="text" placeholder="e.g. taqueria">

    <label>Food type</label>
    <div class="chips" id="flt-types"></div>
    <p class="hint">None selected = all types.</p>

    <label for="flt-ups">Minimum 👍 count</label>
    <input id="flt-ups" type="number" min="0" step="1" value="0">

    <label for="flt-pct">Minimum 👍 %</label>
    <div class="range-row">
      <input id="flt-pct" type="range" min="0" max="100" step="5" value="0">
      <output id="flt-pct-out" for="flt-pct">Any</output>
    </div>

    <label for="flt-submitter">Submitted by</label>
    <select id="flt-submitter"></select>

    <label for="flt-park">Near park</label>
    <input id="flt-park" type="text" list="flt-park-list" placeholder="Any park">
    <datalist id="flt-park-list"></datalist>

    <label class="check"><input type="checkbox" id="flt-following">
      Only people I follow</label>
    <p class="hint">Restaurants they submitted or gave a 👍.</p>

    <p class="result-count" id="flt-count"></p>`;

  const $ = (id) => root.querySelector(`#${id}`);
  $('flt-text').addEventListener('input', (e) => set({ text: e.target.value.trim().toLowerCase() }));
  $('flt-ups').addEventListener('input', (e) => set({ minUps: Math.max(0, parseInt(e.target.value, 10) || 0) }));
  $('flt-pct').addEventListener('input', (e) => set({ minPct: +e.target.value }));
  $('flt-submitter').addEventListener('change', (e) => set({ submitter: e.target.value }));
  $('flt-park').addEventListener('input', (e) => set({ park: e.target.value.trim().toLowerCase() }));
  $('flt-following').addEventListener('change', (e) => set({ followingOnly: e.target.checked }));
  $('flt-types').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const id = +chip.dataset.id;
    if (f.types.has(id)) f.types.delete(id);
    else f.types.add(id);
    set({});
  });
  $('flt-reset').addEventListener('click', () => {
    Object.assign(f, { ...DEFAULTS, types: new Set() });
    syncInputs();
    set({});
  });

  toggleBtn.addEventListener('click', () => {
    root.hidden = !root.hidden;
    toggleBtn.setAttribute('aria-expanded', String(!root.hidden));
  });
}

function set(patch) {
  Object.assign(f, patch);
  syncInputs();
  onApply();
}

// Show only restaurants submitted by one user (used from profile pages).
export function filterBySubmitter(userId) {
  Object.assign(f, { ...DEFAULTS, types: new Set(), submitter: userId });
  refreshFilterOptions();
  root.hidden = false;
  toggleBtn.setAttribute('aria-expanded', 'true');
  set({});
}

function syncInputs() {
  const $ = (id) => root.querySelector(`#${id}`);
  if (!$('flt-text')) return;
  if ($('flt-text').value.trim().toLowerCase() !== f.text) $('flt-text').value = f.text;
  if ((parseInt($('flt-ups').value, 10) || 0) !== f.minUps) $('flt-ups').value = f.minUps;
  $('flt-pct').value = f.minPct;
  $('flt-pct-out').textContent = f.minPct ? `${f.minPct}%+` : 'Any';
  $('flt-submitter').value = f.submitter;
  if ($('flt-park').value.trim().toLowerCase() !== f.park) $('flt-park').value = f.park;
  $('flt-following').checked = f.followingOnly;
  root.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(f.types.has(+c.dataset.id))));

  const active = [f.text, f.minUps, f.minPct, f.types.size, f.submitter, f.park, f.followingOnly].filter(Boolean).length;
  badge.hidden = !active;
  badge.textContent = active;
}

// Rebuild option lists after data changes, keeping current selections.
export function refreshFilterOptions() {
  const types = root.querySelector('#flt-types');
  if (!types) return;
  types.innerHTML = state.foodTypes
    .map((t) => `<button type="button" class="chip" data-id="${t.id}" aria-pressed="false">${esc(t.icon)} ${esc(t.name)}</button>`)
    .join('');

  const submitters = new Map();
  state.restaurants.forEach((r) => submitters.set(r.created_by, r.submitted_by_name));
  const sorted = [...submitters].sort((a, b) => a[1].localeCompare(b[1]));
  root.querySelector('#flt-submitter').innerHTML =
    `<option value="">Anyone</option>` +
    (state.user ? `<option value="${state.user.id}">Me</option>` : '') +
    sorted.filter(([id]) => id !== state.user?.id)
      .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');

  const parks = [...new Set(state.restaurants.map((r) => r.park_name).filter(Boolean))].sort();
  root.querySelector('#flt-park-list').innerHTML = parks.map((p) => `<option value="${esc(p)}">`).join('');

  syncInputs();
}

export function applyFilters(list) {
  const result = list.filter((r) => {
    if (f.text && !r.name.toLowerCase().includes(f.text)) return false;
    if (f.types.size && !f.types.has(r.food_type_id)) return false;
    if (r.ups < f.minUps) return false;
    if (f.minPct && (r.pct_up == null || r.pct_up < f.minPct)) return false;
    if (f.submitter && r.created_by !== f.submitter) return false;
    if (f.park && !(r.park_name || '').toLowerCase().includes(f.park)) return false;
    if (f.followingOnly && !state.following.has(r.created_by) && !state.followedUpvoted.has(r.id)) return false;
    return true;
  });
  const count = root.querySelector('#flt-count');
  if (count) count.textContent = `Showing ${result.length} of ${list.length} restaurants`;
  return result;
}
