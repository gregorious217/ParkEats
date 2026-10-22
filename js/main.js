import { sb, isConfigured } from './supabase.js';
import { state, loadAll, onChange, resetState } from './state.js';
import { initMap, renderMarkers, setMarkerHandlers } from './map.js';
import { initLogin, showLogin, hideLogin } from './auth.js';
import { initFilters, applyFilters, refreshFilterOptions } from './filters.js';
import { openCard, previewHtml } from './card.js';
import { openForm } from './restaurants.js';
import { openProfile } from './social.js';
import { openAdmin } from './admin.js';
import { closePanel, showError } from './ui.js';

const actions = document.getElementById('topbar-actions');
const userBtn = document.getElementById('btn-user');
const userMenu = document.getElementById('user-menu');

initMap();
initLogin();
initFilters(redraw);
setMarkerHandlers({ onClick: (id) => openCard(id), preview: previewHtml });
onChange(() => {
  refreshFilterOptions();
  redraw();
});

function redraw() {
  renderMarkers(applyFilters(state.restaurants));
}

// ---------- Top bar ----------

document.getElementById('btn-add').addEventListener('click', () => openForm());

userBtn.addEventListener('click', () => {
  userMenu.hidden = !userMenu.hidden;
  userBtn.setAttribute('aria-expanded', String(!userMenu.hidden));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) {
    userMenu.hidden = true;
    userBtn.setAttribute('aria-expanded', 'false');
  }
});
userMenu.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  userMenu.hidden = true;
  if (action === 'profile') openProfile(state.user.id);
  if (action === 'admin') openAdmin();
  if (action === 'signout') await sb.auth.signOut();
});

// ---------- Session ----------

async function signedIn(user) {
  if (state.user?.id === user.id) return;
  state.user = user;
  hideLogin();
  try {
    const { data: profile, error } = await sb.from('profiles')
      .select('id, display_name, is_admin, created_at').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!profile) {
      await sb.auth.signOut();
      showLogin('Your account profile is missing. Ask an admin for help.');
      return;
    }
    state.profile = profile;
    userBtn.textContent = profile.display_name;
    document.getElementById('menu-admin').hidden = !profile.is_admin;
    actions.hidden = false;
    await loadAll();
  } catch (err) {
    showError(err);
  }
}

function signedOut() {
  closePanel();
  actions.hidden = true;
  document.getElementById('filters').hidden = true;
  resetState();
  showLogin();
}

if (!isConfigured) {
  showLogin();
} else {
  sb.auth.onAuthStateChange((_event, session) => {
    // Defer: calling Supabase inside this callback can deadlock the auth client.
    setTimeout(() => (session?.user ? signedIn(session.user) : signedOut()), 0);
  });
}
