// Re-download CA State Parks boundaries into data/parks.geojson (simplified ~30 m).
// Only needed if park boundaries change. Usage: node scripts/fetch-parks.mjs

import { writeFile } from 'node:fs/promises';

const SERVICE =
  'https://services2.arcgis.com/AhxrK3F6WM8ECvDi/arcgis/rest/services/ParkBoundaries/FeatureServer/0/query';
const params = new URLSearchParams({
  where: '1=1',
  outFields: 'UNITNAME,UNITNBR,SUBTYPE',
  outSR: '4326',
  maxAllowableOffset: '0.0003',
  geometryPrecision: '5',
  f: 'geojson',
});

const res = await fetch(`${SERVICE}?${params}`);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const geojson = await res.json();
if (geojson.exceededTransferLimit) throw new Error('Too many features for one request; add paging.');

delete geojson.crs;
geojson.features = geojson.features.filter(
  (f) => f.geometry && f.properties.SUBTYPE !== 'Divested Units and Properties',
);

await writeFile(new URL('../data/parks.geojson', import.meta.url), JSON.stringify(geojson));
console.log(`Saved ${geojson.features.length} parks to data/parks.geojson`);
