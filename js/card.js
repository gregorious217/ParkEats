import { sb } from './supabase.js';
import { state, refreshRestaurant } from './state.js';
import { esc, openPanel, showError, toast, timeAgo } from './ui.js';
import { selectMarker, focusRestaurant } from './map.js';
import { openForm, deleteRestaurant } from './restaurants.js';
import { openProfile, toggleFollow } from './social.js';

// Small hover preview (desktop only).
export function previewHtml(r) {
  if (!r) return '';
  const pct = r.pct_up != null ? ` · ${r.pct_up}%` : '';
  return `<div class="preview-card">
    <strong>${esc(r.food_icon)} ${esc(r.name)}</strong>
    <div class="small muted">${esc(r.food_type)}${r.park_name ? ` · near ${esc(r.park_name)}` : ''}</div>
    <div class="small">👍 ${r.ups} &nbsp;👎 ${r.downs}${pct} &nbsp;💬 ${r.comment_count}</div>
    ${r.recommended_item ? `<div class="small">Try: <b>${esc(r.recommended_item)}</b></div>` : ''}
    <div class="small muted">Click for details</div>
  </div>`;
}

export async function openCard(id, { focus = false } = {}) {
  const r = state.byId.get(id);
  if (!r) return toast('That restaurant is no longer on the map.', 'error');
  if (focus) focusRestaurant(r);
  selectMarker(id);

  const ctx = { id, comments: null, photoUrl: null };
  const view = openPanel('', { onClose: () => selectMarker(null) });
  const render = () => {
    const row = state.byId.get(id);
    if (!row) return;
    const draft = view.querySelector('textarea')?.value;
    view.innerHTML = cardHtml(row, ctx);
    if (draft) view.querySelector('textarea').value = draft;
  };
  render();
  wire(view, ctx, render);

  const [comments, photoUrl] = await Promise.all([loadComments(id), signedPhotoUrl(r.photo_path)]);
  Object.assign(ctx, { comments, photoUrl });
  if (view.isConnected) render();
}

async function loadComments(id) {
  const { data, error } = await sb.from('comments')
    .select('id, body, created_at, user_id, profiles(display_name)')
    .eq('restaurant_id', id).order('created_at');
  if (error) {
    showError(error);
    return [];
  }
  return data;
}

async function signedPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await sb.storage.from('photos').createSignedUrl(path, 3600);
  if (error) {
    console.error(error);
    return null;
  }
  return data.signedUrl;
}

function cardHtml(r, ctx) {
  const me = state.user.id;
  const mine = r.created_by === me;
  const canManage = mine || state.profile?.is_admin;
  const myVote = state.myVotes.get(r.id);
  const total = r.ups + r.downs;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`;

  const followBtn = mine ? '' : state.following.has(r.created_by)
    ? `<button class="btn btn-sm" data-act="follow" data-user="${esc(r.created_by)}">✓ Following</button>`
    : `<button class="btn btn-sm" data-act="follow" data-user="${esc(r.created_by)}">＋ Follow</button>`;

  const voteTitle = mine ? 'title="You can\'t vote on your own recommendation"' : '';
  const comments = ctx.comments == null
    ? '<p class="muted small">Loading comments…</p>'
    : ctx.comments.length
      ? ctx.comments.map((c) => commentHtml(c, me)).join('')
      : '<p class="muted small">No comments yet. Be the first!</p>';

  return `
    <div class="card-head">
      <h2>${esc(r.food_icon)} ${esc(r.name)}</h2>
      <span class="tag">${esc(r.food_type)}</span>
      ${r.park_name ? `<span class="tag tag-park">🌲 ${esc(r.park_name)} · ${r.park_distance_mi} mi</span>` : ''}
    </div>
    ${r.address ? `<p class="small">${esc(r.address)}</p>` : ''}
    <a class="small" href="${directions}" target="_blank" rel="noopener">Directions ↗</a>

    ${ctx.photoUrl ? `<img class="photo" src="${esc(ctx.photoUrl)}" alt="Photo of ${esc(r.name)}">` : ''}
    ${r.recommended_item ? `<div class="try">Try the <b>${esc(r.recommended_item)}</b></div>` : ''}
    ${r.comment ? `<p class="pre">${esc(r.comment)}</p>` : ''}

    <div class="byline">
      <span class="small muted">Recommended by
        <button class="linkish" data-act="profile" data-user="${esc(r.created_by)}">${esc(r.submitted_by_name)}</button>
        · ${timeAgo(r.created_at)}</span>
      ${followBtn}
    </div>

    <div class="votes">
      <button class="btn vote-btn up" data-act="vote" data-value="1" aria-pressed="${myVote === 1}" ${mine ? 'disabled' : ''} ${voteTitle}>👍 ${r.ups}</button>
      <button class="btn vote-btn down" data-act="vote" data-value="-1" aria-pressed="${myVote === -1}" ${mine ? 'disabled' : ''} ${voteTitle}>👎 ${r.downs}</button>
      <span class="small muted">${total ? `${r.pct_up}% positive` : 'No votes yet'}</span>
      ${total ? `<div class="pct-bar" aria-hidden="true"><span style="width:${r.pct_up}%"></span></div>` : ''}
    </div>

    <h3 class="section-title">Comments (${ctx.comments ? ctx.comments.length : r.comment_count})</h3>
    ${comments}
    <form data-form="comment">
      <label for="comment-body">Add a comment</label>
      <textarea id="comment-body" maxlength="1000" required placeholder="What did you have? How was it?"></textarea>
      <button class="btn btn-primary btn-sm" type="submit" style="margin-top:8px">Post comment</button>
    </form>

    <div class="card-actions">
      ${canManage ? `<button class="btn btn-sm" data-act="edit">✎ Edit</button>
                     <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>` : ''}
      ${mine ? '' : `<button class="btn btn-sm" data-act="flag">⚑ Report</button>`}
    </div>`;
}

function commentHtml(c, me) {
  const canDelete = c.user_id === me || state.profile?.is_admin;
  return `<div class="comment">
    <div class="comment-meta">
      <button class="linkish" data-act="profile" data-user="${esc(c.user_id)}">${esc(c.profiles?.display_name ?? 'Someone')}</button>
      <span>${timeAgo(c.created_at)}</span>
      ${canDelete ? `<button class="linkish" data-act="del-comment" data-id="${c.id}">delete</button>` : ''}
      ${c.user_id === me ? '' : `<button class="linkish" data-act="flag-comment" data-id="${c.id}">report</button>`}
    </div>
    <p>${esc(c.body)}</p>
  </div>`;
}

function wire(view, ctx, render) {
  const id = ctx.id;

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === 'vote') {
        btn.disabled = true;
        await vote(id, +btn.dataset.value);
        render();
      } else if (act === 'profile') {
        openProfile(btn.dataset.user);
      } else if (act === 'follow') {
        btn.disabled = true;
        await toggleFollow(btn.dataset.user);
        render();
      } else if (act === 'edit') {
        openForm(state.byId.get(id));
      } else if (act === 'delete') {
        await deleteRestaurant(state.byId.get(id));
      } else if (act === 'flag') {
        await report('restaurant', id);
      } else if (act === 'flag-comment') {
        await report('comment', +btn.dataset.id);
      } else if (act === 'del-comment') {
        if (!confirm('Delete this comment?')) return;
        const { error } = await sb.from('comments').delete().eq('id', +btn.dataset.id);
        if (error) throw error;
        ctx.comments = ctx.comments.filter((c) => c.id !== +btn.dataset.id);
        await refreshRestaurant(id);
        render();
      }
    } catch (err) {
      showError(err);
      render();
    }
  });

  view.addEventListener('submit', async (e) => {
    if (e.target.dataset.form !== 'comment') return;
    e.preventDefault();
    const textarea = e.target.querySelector('textarea');
    const body = textarea.value.trim();
    if (!body) return;
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const { error } = await sb.from('comments').insert({ restaurant_id: id, user_id: state.user.id, body });
      if (error) throw error;
      textarea.value = '';
      ctx.comments = await loadComments(id);
      await refreshRestaurant(id);
      render();
    } catch (err) {
      showError(err);
      submit.disabled = false;
    }
  });
}

async function vote(id, value) {
  const current = state.myVotes.get(id);
  if (current === value) {
    // Clicking the same thumb again removes the vote.
    const { error } = await sb.from('votes').delete().match({ restaurant_id: id, user_id: state.user.id });
    if (error) throw error;
    state.myVotes.delete(id);
  } else {
    const { error } = await sb.from('votes')
      .upsert({ restaurant_id: id, user_id: state.user.id, value }, { onConflict: 'restaurant_id,user_id' });
    if (error) throw error;
    state.myVotes.set(id, value);
  }
  await refreshRestaurant(id);
}

async function report(targetType, targetId) {
  const reason = prompt('Why are you reporting this? (optional)');
  if (reason === null) return;
  const { error } = await sb.from('flags').insert({
    target_type: targetType, target_id: targetId, reporter_id: state.user.id, reason: reason.trim().slice(0, 500) || null,
  });
  if (error?.code === '23505') return toast("You've already reported this. An admin will review it.");
  if (error) throw error;
  toast('Thanks. An admin will review it.');
}
