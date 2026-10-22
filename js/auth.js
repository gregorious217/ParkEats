import { sb, isConfigured } from './supabase.js';
import { ALLOWED_EMAIL_DOMAIN } from './config.js';

const modal = document.getElementById('login');
const emailForm = document.getElementById('login-email-form');
const codeForm = document.getElementById('login-code-form');
const errorEl = document.getElementById('login-error');
let pendingEmail = '';

export function initLogin() {
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
      errorEl.textContent = `Please use your @${ALLOWED_EMAIL_DOMAIN} email address.`;
      return;
    }
    const btn = emailForm.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    btn.disabled = false;
    if (error) {
      errorEl.textContent = error.message;
      return;
    }
    pendingEmail = email;
    document.getElementById('login-sent-to').textContent = email;
    emailForm.hidden = true;
    codeForm.hidden = false;
    document.getElementById('login-code').focus();
  });

  // Typing the emailed code avoids problems with link scanners and opening the link in another browser.
  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const token = document.getElementById('login-code').value.trim();
    const btn = codeForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
    btn.disabled = false;
    if (error) errorEl.textContent = 'That code is invalid or has expired. Request a new one.';
  });

  document.getElementById('login-back').addEventListener('click', () => {
    codeForm.hidden = true;
    emailForm.hidden = false;
    errorEl.textContent = '';
  });
}

export function showLogin(message = '') {
  codeForm.hidden = true;
  emailForm.hidden = false;
  errorEl.textContent = message;
  if (!isConfigured) {
    errorEl.textContent = 'Setup needed: add your Supabase URL and key to js/config.js (see README).';
    emailForm.querySelector('button').disabled = true;
  }
  modal.hidden = false;
}

export function hideLogin() {
  modal.hidden = true;
}
