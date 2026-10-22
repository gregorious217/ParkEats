import { sb, fetchAll } from './supabase.js';
import { state, emit, loadFollowing, loadRestaurants } from './state.js';
import { esc, openPanel, showError, toast, timeAgo } from './ui.js';
import { openCard } from './card.js';
import { filterBySubmitter } from './filters.js';

export async function toggleFollow(userId) {
  if (state.following.has(userId)) {
    const { error } = await sb.from('follows').delete().match({ follower_id: state.user.id, followee_id: userId });
    if (error) throw error;
  } else {
    const { error } = await sb.from('follows').insert({ follower_id: state.user.id, followee_id: userId });
    if (error && error.code !== '23505') throw error;
  }
  await loadFollowing();
  emit();
}

export async function openProfile(userId) {
  const isMe = userId === state.user.id;
  const view = openPanel('<p class="muted">Loading profile…</p>');

  try {
    const [profileRes, followersRes, followingRes, people] = await Promise.all([
      sb.from('profiles').select('id, display_name, created_at').eq('id', userId).single(),
      sb.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', userId),
      sb.from('follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', userId),
      isMe ? fetchAll(() => sb.from('profiles').select('id, display_name').order('display_name')) : null,
    ]);
    if (profileRes.error) throw profileRes.error;
    const ctx = { profile: profileRes.data, followers: followersRes.count ?? 0, followingCount: followingRes.count ?? 0, people };

    const render = () => {
      if (view.isConnected) view.innerHTML = profileHtml(ctx, isMe);
    };
    render();

    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      try {
        if (btn.dataset.act === 'open') {
          openCard(+btn.dataset.id, { focus: true });
        } else if (btn.dataset.act === 'follow') {
          btn.disabled = true;
          const target = btn.dataset.user;
          const wasFollowing = state.following.has(target);
          await toggleFollow(target);
          if (target === userId) ctx.followers += wasFollowing ? -1 : 1;
          if (isMe) ctx.followingCount += wasFollowing ? -1 : 1;
          render();
        } else if (btn.dataset.act === 'person') {
          openProfile(btn.dataset.user);
        } else if (btn.dataset.act === 'show-pins') {
          filterBySubmitter(userId);
        }
      } catch (err) {
        showError(err);
        render();
      }
    });

    view.addEventListener('submit', async (e) => {
      if (e.target.dataset.form !== 'name') return;
      e.preventDefault();
      const name = e.target.querySelector('input').value.trim();
      if (!name) return;
      try {
        const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', state.user.id);
        if (error) throw error;
        state.profile.display_name = name;
        ctx.profile.display_name = name;
        document.getElementById('btn-user').textContent = name;
        await loadRestaurants();
        emit();
        toast('Display name updated.');
        render();
      } catch (err) {
        showError(err);
      }
    });
  } catch (err) {
    showError(err);
    view.innerHTML = '<p class="muted">Could not load this profile.</p>';
  }
}

function profileHtml(ctx, isMe) {
  const p = ctx.profile;
  const pins = state.restaurants.filter((r) => r.created_by === p.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const following = state.following.has(p.id);

  const pinList = pins.length
    ? `<ul class="list">${pins.map((r) => `<li><button class="list-btn" data-act="open" data-id="${r.id}">
        <strong>${esc(r.food_icon)} ${esc(r.name)}</strong><br>
        <span class="small muted">${esc(r.park_name ?? '')} · 👍 ${r.ups} 👎 ${r.downs} · ${timeAgo(r.created_at)}</span>
      </button></li>`).join('')}</ul>`
    : '<p class="muted small">No recommendations yet.</p>';

  const people = isMe && ctx.people
    ? ctx.people.filter((u) => u.id !== p.id).map((u) => {
        const n = state.restaurants.filter((r) => r.created_by === u.id).length;
        const f = state.following.has(u.id);
        return `<li class="row spread">
          <button class="linkish" data-act="person" data-user="${esc(u.id)}">${esc(u.display_name)}</button>
          <span class="small muted">${n} pin${n === 1 ? '' : 's'}</span>
          <button class="btn btn-sm" data-act="follow" data-user="${esc(u.id)}">${f ? '✓ Following' : '＋ Follow'}</button>
        </li>`;
      }).join('')
    : '';

  return `
    <div class="card-head"><h2>${esc(p.display_name)}${isMe ? ' <span class="muted small">(you)</span>' : ''}</h2>
      <p class="small muted">Joined ${timeAgo(p.created_at)}</p></div>
    <div class="stat-row">
      <div class="stat"><b>${pins.length}</b>recommendations</div>
      <div class="stat"><b>${ctx.followers}</b>followers</div>
      <div class="stat"><b>${ctx.followingCount}</b>following</div>
    </div>
    <div class="row">
      ${isMe ? '' : `<button class="btn btn-primary btn-sm" data-act="follow" data-user="${esc(p.id)}">${following ? '✓ Following' : '＋ Follow'}</button>`}
      ${pins.length ? `<button class="btn btn-sm" data-act="show-pins">Show only ${isMe ? 'my' : 'their'} pins on map</button>` : ''}
    </div>

    ${isMe ? `<form data-form="name">
      <label for="display-name">Display name</label>
      <div class="row"><input id="display-name" type="text" maxlength="60" required value="${esc(p.display_name)}" style="flex:1">
      <button class="btn btn-sm" type="submit">Save</button></div>
    </form>` : ''}

    <h3 class="section-title">Recommendations</h3>
    ${pinList}
    ${isMe ? `<h3 class="section-title">People</h3><ul class="list">${people || '<li class="muted small">No one else yet.</li>'}</ul>` : ''}`;
}
