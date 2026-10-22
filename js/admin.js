import { sb } from './supabase.js';
import { state, emit, loadFoodTypes, loadRestaurants, refreshRestaurant } from './state.js';
import { esc, openPanel, showError, toast, timeAgo } from './ui.js';
import { openCard } from './card.js';
import { deleteRestaurant } from './restaurants.js';

export async function openAdmin() {
  if (!state.profile?.is_admin) return;
  const view = openPanel('<p class="muted">Loading…</p>');
  const ctx = { flags: [], comments: new Map() };

  async function loadFlags() {
    const { data, error } = await sb.from('flags')
      .select('id, target_type, target_id, reason, created_at, profiles(display_name)')
      .eq('resolved', false).order('created_at');
    if (error) throw error;
    ctx.flags = data;
    const commentIds = data.filter((f) => f.target_type === 'comment').map((f) => f.target_id);
    ctx.comments = new Map();
    if (commentIds.length) {
      const { data: comments, error: cErr } = await sb.from('comments')
        .select('id, body, restaurant_id').in('id', commentIds);
      if (cErr) throw cErr;
      comments.forEach((c) => ctx.comments.set(c.id, c));
    }
  }

  const render = () => {
    if (view.isConnected) view.innerHTML = adminHtml(ctx);
  };

  try {
    await loadFlags();
    render();
  } catch (err) {
    showError(err);
  }

  async function resolve(flag) {
    // Resolve every open report about the same item.
    const { error } = await sb.from('flags').update({ resolved: true })
      .match({ target_type: flag.target_type, target_id: flag.target_id });
    if (error) throw error;
  }

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const flag = ctx.flags.find((f) => f.id === +btn.dataset.flag);
    try {
      switch (btn.dataset.act) {
        case 'view': {
          const id = flag.target_type === 'restaurant' ? flag.target_id : ctx.comments.get(flag.target_id)?.restaurant_id;
          if (id && state.byId.has(id)) openCard(id, { focus: true });
          else toast('That item no longer exists.');
          return;
        }
        case 'dismiss':
          await resolve(flag);
          break;
        case 'remove':
          if (flag.target_type === 'restaurant') {
            const r = state.byId.get(flag.target_id);
            if (r && !(await deleteRestaurant(r))) return;
            await resolve(flag);
            openAdmin();
            return;
          } else {
            if (!confirm('Delete this comment?')) return;
            const c = ctx.comments.get(flag.target_id);
            const { error } = await sb.from('comments').delete().eq('id', flag.target_id);
            if (error) throw error;
            if (c) await refreshRestaurant(c.restaurant_id);
            await resolve(flag);
          }
          break;
        case 'type-save': {
          const row = btn.closest('[data-type]');
          const { error } = await sb.from('food_types').update(readType(row)).eq('id', +row.dataset.type);
          if (error) throw error;
          await reloadTypes();
          toast('Food type saved.');
          break;
        }
        case 'type-delete': {
          const row = btn.closest('[data-type]');
          if (!confirm('Delete this food type?')) return;
          const { error } = await sb.from('food_types').delete().eq('id', +row.dataset.type);
          if (error?.code === '23503') return toast('That type is in use. Rename it instead, or move those restaurants first.', 'error');
          if (error) throw error;
          await reloadTypes();
          break;
        }
        case 'type-add': {
          const row = btn.closest('[data-new-type]');
          const values = readType(row);
          if (!values.name) return toast('Enter a name.', 'error');
          const { error } = await sb.from('food_types').insert(values);
          if (error) throw error;
          await reloadTypes();
          break;
        }
        default:
          return;
      }
      await loadFlags();
      render();
    } catch (err) {
      showError(err);
    }
  });
}

async function reloadTypes() {
  await Promise.all([loadFoodTypes(), loadRestaurants()]);
  emit();
}

function readType(row) {
  return {
    icon: row.querySelector('[name="icon"]').value.trim() || '🍽️',
    name: row.querySelector('[name="name"]').value.trim(),
    sort_order: parseInt(row.querySelector('[name="sort"]').value, 10) || 100,
  };
}

function adminHtml(ctx) {
  const flags = ctx.flags.length
    ? `<ul class="list">${ctx.flags.map((f) => {
        let what;
        if (f.target_type === 'restaurant') {
          what = `Restaurant: <b>${esc(state.byId.get(f.target_id)?.name ?? '(deleted)')}</b>`;
        } else {
          const c = ctx.comments.get(f.target_id);
          what = `Comment: <span class="pre">"${esc(c?.body ?? '(deleted)')}"</span>`;
        }
        return `<li>
          <div>${what}</div>
          <div class="small muted">Reported by ${esc(f.profiles?.display_name ?? 'someone')} · ${timeAgo(f.created_at)}</div>
          ${f.reason ? `<div class="small">Reason: ${esc(f.reason)}</div>` : ''}
          <div class="row" style="margin-top:6px">
            <button class="btn btn-sm" data-act="view" data-flag="${f.id}">View</button>
            <button class="btn btn-sm btn-danger" data-act="remove" data-flag="${f.id}">Delete content</button>
            <button class="btn btn-sm" data-act="dismiss" data-flag="${f.id}">Dismiss</button>
          </div></li>`;
      }).join('')}</ul>`
    : '<p class="muted small">No open reports. 🎉</p>';

  const typeRow = (t) => `
    <li class="row" data-type="${t.id}">
      <input name="icon" value="${esc(t.icon)}" style="width:3.2em" aria-label="Icon">
      <input name="name" value="${esc(t.name)}" style="flex:1;min-width:8em" aria-label="Name">
      <input name="sort" type="number" value="${t.sort_order}" style="width:5em" aria-label="Sort order">
      <button class="btn btn-sm" data-act="type-save">Save</button>
      <button class="btn btn-sm btn-danger" data-act="type-delete" aria-label="Delete ${esc(t.name)}">✕</button>
    </li>`;

  return `
    <h2>Admin</h2>
    <h3 class="section-title">Reported content (${ctx.flags.length})</h3>
    ${flags}
    <h3 class="section-title">Food types</h3>
    <p class="hint">Icon (emoji), name, sort order. Types in use can't be deleted.</p>
    <ul class="list">${state.foodTypes.map(typeRow).join('')}
      <li class="row" data-new-type>
        <input name="icon" placeholder="🍽️" style="width:3.2em" aria-label="New icon">
        <input name="name" placeholder="New type" style="flex:1;min-width:8em" aria-label="New name">
        <input name="sort" type="number" value="100" style="width:5em" aria-label="New sort order">
        <button class="btn btn-sm btn-primary" data-act="type-add">Add</button>
      </li>
    </ul>`;
}
