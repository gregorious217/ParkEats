import { sb } from './supabase.js';
import { state, refreshRestaurant, removeRestaurant } from './state.js';
import { esc, openPanel, closePanel, showError, errorMessage, toast, debounce } from './ui.js';
import { startPlacement, stopPlacement, placeAt, mapCenter } from './map.js';
import { openCard } from './card.js';
import { MAX_PARK_DISTANCE_MI } from './config.js';

const PHOTON = 'https://photon.komoot.io';
const CA_BBOX = '-124.6,32.4,-114.0,42.1';
const MAX_PHOTO_PX = 1600;

// Open the add form (no argument) or the edit form for an existing row.
export function openForm(existing = null) {
  const editing = !!existing;
  const s = {
    loc: editing ? { lat: existing.lat, lng: existing.lng } : null,
    park: null,           // { unit_name, distance_mi } or false when too far
    dups: [],
    photoFile: null,      // new file chosen
    removePhoto: false,
    checkSeq: 0,
  };

  const view = openPanel(formHtml(existing), { onClose: stopPlacement });
  const $ = (sel) => view.querySelector(sel);

  // ----- location -----
  const onMove = async (latlng) => {
    s.loc = { lat: latlng.lat, lng: latlng.lng };
    const seq = ++s.checkSeq;
    setLocNotice('notice', 'Checking distance to nearest State Park…');
    try {
      const { data, error } = await sb.rpc('nearest_park', { p_lat: s.loc.lat, p_lng: s.loc.lng });
      if (error) throw error;
      if (seq !== s.checkSeq) return;
      s.park = data?.[0] || false;
      if (s.park) setLocNotice('notice-ok', `🌲 ${s.park.distance_mi} mi from ${s.park.unit_name}`);
      else setLocNotice('notice-bad', `This spot is more than ${MAX_PARK_DISTANCE_MI} miles from any State Park, so it can't be saved here.`);
    } catch (err) {
      if (seq === s.checkSeq) setLocNotice('notice-bad', errorMessage(err));
    }
    if (!$('#f-address').value.trim()) reverseGeocode(s.loc, seq);
    checkDuplicates();
  };

  function setLocNotice(kind, text) {
    const el = $('#f-location');
    el.className = `notice ${kind}`;
    el.textContent = text;
  }

  async function reverseGeocode({ lat, lng }, seq) {
    try {
      const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&limit=1&lang=en`);
      const feature = (await res.json()).features?.[0];
      if (feature && seq === s.checkSeq && !$('#f-address').value.trim()) {
        $('#f-address').value = formatAddress(feature.properties);
      }
    } catch { /* address is optional */ }
  }

  // ----- duplicates -----
  const checkDuplicates = debounce(async () => {
    const name = $('#f-name').value.trim();
    const box = $('#f-dups');
    if (!s.loc || name.length < 3) {
      s.dups = [];
      box.innerHTML = '';
      return;
    }
    const { data, error } = await sb.rpc('find_nearby_duplicates', {
      p_lat: s.loc.lat, p_lng: s.loc.lng, p_name: name, p_exclude_id: existing?.id ?? null,
    });
    if (error) return console.error(error);
    s.dups = data;
    box.innerHTML = data.length
      ? `<div class="notice notice-warn">Possible duplicate:
          ${data.map((d) => `<button type="button" class="linkish" data-dup="${d.id}">${esc(d.name)}</button> (${d.distance_m} m away)`).join(', ')}.
          Consider voting or commenting on it instead.</div>`
      : '';
  }, 400);

  view.addEventListener('click', (e) => {
    const dup = e.target.closest('[data-dup]');
    if (dup) openCard(+dup.dataset.dup, { focus: true });
  });
  $('#f-name').addEventListener('input', checkDuplicates);

  // ----- place search -----
  const results = $('#f-results');
  const search = debounce(async (q) => {
    if (q.length < 3) {
      results.hidden = true;
      return;
    }
    try {
      const c = mapCenter();
      const res = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=${CA_BBOX}&lat=${c.lat}&lon=${c.lng}`);
      const features = (await res.json()).features || [];
      results.innerHTML = features.length
        ? features.map((f, i) => `<li><button type="button" data-i="${i}">
            <strong>${esc(f.properties.name || formatAddress(f.properties))}</strong><br>
            <span class="small muted">${esc(formatAddress(f.properties))}</span></button></li>`).join('')
        : '<li class="small muted" style="padding:8px">No matches. Try clicking the map instead.</li>';
      results.hidden = false;
      results.onclick = (e) => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        const f = features[+b.dataset.i];
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        if (p.name && !$('#f-name').value.trim() && p.osm_key === 'amenity') $('#f-name').value = p.name;
        $('#f-address').value = formatAddress(p);
        results.hidden = true;
        placeAt(lat, lng);
      };
    } catch (err) {
      console.error(err);
    }
  }, 350);
  $('#f-search').addEventListener('input', (e) => search(e.target.value.trim()));
  $('#f-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
    if (e.key === 'Escape') results.hidden = true;
  });

  // ----- photo -----
  $('#f-photo').addEventListener('change', (e) => {
    s.photoFile = e.target.files[0] || null;
    const preview = $('#f-photo-preview');
    if (s.photoFile) {
      preview.src = URL.createObjectURL(s.photoFile);
      preview.hidden = false;
      $('#f-photo-remove').hidden = false;
    }
  });
  $('#f-photo-remove').addEventListener('click', () => {
    s.photoFile = null;
    s.removePhoto = true;
    $('#f-photo').value = '';
    $('#f-photo-preview').hidden = true;
    $('#f-photo-remove').hidden = true;
    $('#f-photo-hint')?.remove();
  });

  $('#f-cancel').addEventListener('click', () => {
    if (editing) openCard(existing.id);
    else closePanel();
  });

  // ----- save -----
  $('#f-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#f-error');
    err.textContent = '';
    if (!s.loc) return (err.textContent = 'Search for the place or click the map to set its location.');
    if (s.park === false) return (err.textContent = `It must be within ${MAX_PARK_DISTANCE_MI} miles of a State Park.`);
    if (s.dups.length && !confirm(`"${s.dups[0].name}" is already on the map right here. Save anyway?`)) return;

    const save = $('#f-save');
    save.disabled = true;
    save.textContent = 'Saving…';
    let uploadedPath = null;
    try {
      let photoPath = existing?.photo_path ?? null;
      if (s.photoFile) {
        uploadedPath = await uploadPhoto(s.photoFile);
        photoPath = uploadedPath;
      } else if (s.removePhoto) {
        photoPath = null;
      }

      const row = {
        name: $('#f-name').value.trim(),
        food_type_id: +$('#f-type').value,
        address: $('#f-address').value.trim() || null,
        recommended_item: $('#f-item').value.trim() || null,
        comment: $('#f-comment').value.trim() || null,
        location: `SRID=4326;POINT(${s.loc.lng} ${s.loc.lat})`,
        photo_path: photoPath,
      };

      let id = existing?.id;
      if (editing) {
        const { error } = await sb.from('restaurants').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('restaurants')
          .insert({ ...row, created_by: state.user.id }).select('id').single();
        if (error) throw error;
        id = data.id;
      }

      // Clean up a replaced or removed photo.
      if (existing?.photo_path && existing.photo_path !== photoPath) {
        await sb.storage.from('photos').remove([existing.photo_path]);
      }

      stopPlacement();
      await refreshRestaurant(id);
      toast(editing ? 'Saved.' : 'Thanks for the recommendation!');
      openCard(id);
    } catch (e2) {
      if (uploadedPath) await sb.storage.from('photos').remove([uploadedPath]);
      err.textContent = errorMessage(e2);
      save.disabled = false;
      save.textContent = editing ? 'Save changes' : 'Add restaurant';
    }
  });

  startPlacement(onMove, editing ? { lat: existing.lat, lng: existing.lng } : null);
  if (editing) checkDuplicates();
}

function formHtml(r) {
  const editing = !!r;
  const types = state.foodTypes
    .map((t) => `<option value="${t.id}" ${r?.food_type_id === t.id ? 'selected' : ''}>${esc(t.icon)} ${esc(t.name)}</option>`)
    .join('');
  return `
    <h2>${editing ? 'Edit restaurant' : 'Add a restaurant'}</h2>
    <p class="step">Search for the place, or <b>click the map</b> to drop a pin. Drag the pin to fine-tune.
      It must be within ${MAX_PARK_DISTANCE_MI} miles of a State Park.</p>

    <label for="f-search">Find a place</label>
    <div class="search-wrap">
      <input id="f-search" type="text" autocomplete="off" placeholder="Restaurant name, address or town">
      <ul class="search-results" id="f-results" hidden></ul>
    </div>
    <div id="f-location" class="notice notice-warn">${editing ? '' : 'No location yet.'}</div>
    <div id="f-dups"></div>

    <form id="f-form" novalidate>
      <label for="f-name">Restaurant name *</label>
      <input id="f-name" type="text" maxlength="120" required value="${esc(r?.name)}">

      <label for="f-type">Food type *</label>
      <select id="f-type" required>${types}</select>

      <label for="f-address">Address</label>
      <input id="f-address" type="text" maxlength="300" value="${esc(r?.address)}">

      <label for="f-item">Recommended menu item</label>
      <input id="f-item" type="text" maxlength="200" placeholder="e.g. Fish tacos" value="${esc(r?.recommended_item)}">

      <label for="f-comment">Comment</label>
      <textarea id="f-comment" maxlength="2000" placeholder="Why do you recommend it?">${esc(r?.comment)}</textarea>

      <label for="f-photo">Photo (optional)</label>
      <input id="f-photo" type="file" accept="image/*">
      <img id="f-photo-preview" class="photo-preview" alt="" hidden>
      ${r?.photo_path ? '<p class="hint" id="f-photo-hint">This restaurant has a photo. Choose a new file to replace it.</p>' : ''}
      <button type="button" class="btn-link" id="f-photo-remove" ${r?.photo_path ? '' : 'hidden'}>Remove photo</button>

      <p class="form-error" id="f-error" role="alert"></p>
      <div class="row">
        <button class="btn btn-primary" id="f-save" type="submit">${editing ? 'Save changes' : 'Add restaurant'}</button>
        <button class="btn" id="f-cancel" type="button">Cancel</button>
      </div>
    </form>`;
}

function formatAddress(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  return [street, p.city || p.town || p.village || p.county, p.state].filter(Boolean).join(', ');
}

// Shrink photos client-side so uploads are small and fast.
async function resizeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file doesn't look like an image."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_PHOTO_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadPhoto(file) {
  const blob = await resizeImage(file);
  const path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

export async function deleteRestaurant(r) {
  if (!r || !confirm(`Delete "${r.name}"? Its votes and comments will be deleted too.`)) return false;
  const { error } = await sb.from('restaurants').delete().eq('id', r.id);
  if (error) {
    showError(error);
    return false;
  }
  if (r.photo_path) await sb.storage.from('photos').remove([r.photo_path]);
  closePanel();
  removeRestaurant(r.id);
  toast('Deleted.');
  return true;
}
