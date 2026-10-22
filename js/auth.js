import { sb, isConfigured } from './supabase.js';

const modal = document.getElementById('login');
const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
const $ = (id) => document.getElementById(id);
let mode = 'signin'; // or 'signup'

const FRIENDLY = [
  [/invalid login credentials/i, 'Wrong email or password.'],
  [/already registered|already exists/i, 'An account with this email already exists. Sign in instead.'],
  [/password should be at least/i, 'Password must be at least 8 characters.'],
  [/email not confirmed/i, 'Email confirmation is still on in Supabase. Turn off "Confirm email" (see README).'],
];
const friendly = (msg) => FRIENDLY.find(([re]) => re.test(msg))?.[1] ?? msg;

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  $('login-name-row').hidden = !signup;
  $('login-name').required = signup;
  $('login-password-hint').hidden = !signup;
  $('login-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('login-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('login-switch-text').textContent = signup ? 'Already have an account?' : 'New here?';
  $('login-switch').textContent = signup ? 'Sign in' : 'Create an account';
  errorEl.textContent = '';
}

export function initLogin() {
  $('login-switch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const email = $('login-email').value.trim().toLowerCase();
    const password = $('login-password').value;
    const btn = $('login-submit');
    btn.disabled = true;

    let result;
    if (mode === 'signup') {
      const displayName = $('login-name').value.trim();
      result = await sb.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
      if (!result.error && !result.data.session) {
        result.error = { message: 'Email not confirmed' };
      }
    } else {
      result = await sb.auth.signInWithPassword({ email, password });
    }

    btn.disabled = false;
    if (result.error) {
      errorEl.textContent = friendly(result.error.message);
      return;
    }
    form.reset();
  });
}

export function showLogin(message = '') {
  setMode('signin');
  errorEl.textContent = message;
  if (!isConfigured) {
    errorEl.textContent = 'Setup needed: add your Supabase URL and key to js/config.js (see README).';
    $('login-submit').disabled = true;
  }
  modal.hidden = false;
}

export function hideLogin() {
  modal.hidden = true;
}
