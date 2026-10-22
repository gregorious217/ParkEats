import { esc, toast } from './ui.js';

const CA_CENTER = [37.2, -119.5];
const canHover = window.matchMedia('(hover: hover)').matches;

let map;
let cluster;
const markers = new Map(); // restaurant id -> L.Marker
const rows = new Map();    // restaurant id -> row used to draw its icon
let selectedId = null;
let handlers = { onClick: () => {}, preview: () => '' };

// Pin placement (add / edit form)
let placing = null; // { onMove }
let placementMarker = null;

export function initMap() {
  map = L.map('map', { zoomControl: true, minZoom: 5 }).setView(CA_CENTER, 6);
  map.zoomControl.setPosition('bottomright');

  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const attribution = 'Basemap &copy; Esri and contributors, &copy; OpenStreetMap · Park boundaries: CA State Parks';
  const light = L.tileLayer(`${esri}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    attribution, maxZoom: 19, maxNativeZoom: 16,
  }).addTo(map);
  const streets = L.tileLayer(`${esri}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, { attribution, maxZoom: 19 });
  const imagery = L.tileLayer(`${esri}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { attribution, maxZoom: 19 });
  L.control.layers({ 'Light gray': light, Streets: streets, Imagery: imagery }, null, { position: 'bottomleft' }).addTo(map);

  map.createPane('parks');
  map.getPane('parks').style.zIndex = 350;

  // Place and road labels drawn above the park fill.
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';
  const labels = L.tileLayer(`${esri}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
    pane: 'labels',
    maxZoom: 19,
    maxNativeZoom: 16,
  }).addTo(map);
  map.on('baselayerchange', (e) => (e.layer === light ? labels.addTo(map) : labels.remove()));
  loadParks();

  cluster = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false, spiderfyOnMaxZoom: true });
  map.addLayer(cluster);

  map.on('click', (e) => {
    if (placing) setPlacement(e.latlng);
  });
  return map;
}

async function loadParks() {
  try {
    const res = await fetch('data/parks.geojson');
    const geojson = await res.json();
    L.geoJSON(geojson, {
      pane: 'parks',
      renderer: L.canvas({ pane: 'parks' }),
      style: { color: '#5e7553', weight: 1, opacity: 0.7, fillColor: '#9caf88', fillOpacity: 0.35 },
      onEachFeature: (f, layer) =>
        layer.bindTooltip(esc(f.properties.UNITNAME), { sticky: true, className: 'park-tip' }),
    }).addTo(map);
  } catch (err) {
    console.error(err);
    toast('Could not load park boundaries.', 'error');
  }
}

export function setMarkerHandlers(h) {
  handlers = { ...handlers, ...h };
}

function pinIcon(r) {
  let mood = '';
  if (r.pct_up != null) mood = r.pct_up >= 75 ? 'good' : r.pct_up >= 40 ? 'mixed' : 'bad';
  const cls = ['pin', mood, r.id === selectedId ? 'selected' : ''].join(' ');
  return L.divIcon({
    className: '',
    html: `<div class="${cls}">${esc(r.food_icon)}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export function renderMarkers(list) {
  cluster.clearLayers();
  markers.clear();
  rows.clear();
  const layers = list.map((r) => {
    const m = L.marker([r.lat, r.lng], { icon: pinIcon(r), title: r.name, riseOnHover: true });
    if (canHover) {
      m.bindTooltip(() => handlers.preview(rows.get(r.id)), {
        direction: 'top', offset: [0, -18], className: 'preview', opacity: 1,
      });
    }
    m.on('click', () => {
      if (!placing) handlers.onClick(r.id);
    });
    markers.set(r.id, m);
    rows.set(r.id, r);
    return m;
  });
  cluster.addLayers(layers);
}

export function selectMarker(id) {
  const prev = selectedId;
  selectedId = id;
  for (const key of [prev, id]) {
    if (key != null && markers.has(key)) markers.get(key).setIcon(pinIcon(rows.get(key)));
  }
}

export function focusRestaurant(r) {
  const m = markers.get(r.id);
  if (m) cluster.zoomToShowLayer(m);
  else map.setView([r.lat, r.lng], Math.max(map.getZoom(), 14));
}

// ---------- Placement mode ----------

const newPinIcon = L.divIcon({
  className: '',
  html: '<div class="pin pin-new">＋</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

export function startPlacement(onMove, latlng) {
  placing = { onMove };
  document.body.classList.add('placing');
  if (latlng) placeAt(latlng.lat, latlng.lng);
}

export function placeAt(lat, lng) {
  setPlacement(L.latLng(lat, lng));
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
}

function setPlacement(latlng) {
  if (!placing) return;
  if (!placementMarker) {
    placementMarker = L.marker(latlng, { draggable: true, icon: newPinIcon, zIndexOffset: 1000 }).addTo(map);
    placementMarker.on('dragend', () => placing?.onMove(placementMarker.getLatLng()));
  } else {
    placementMarker.setLatLng(latlng);
  }
  placing.onMove(latlng);
}

export function stopPlacement() {
  placing = null;
  document.body.classList.remove('placing');
  if (placementMarker) {
    placementMarker.remove();
    placementMarker = null;
  }
}

export const mapCenter = () => map.getCenter();
