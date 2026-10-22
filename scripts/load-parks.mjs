// One-time load of data/parks.geojson into the Supabase `parks` table.
// No npm install needed (Node 18+).
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SECRET_KEY=... node scripts/load-parks.mjs
//
// SUPABASE_SECRET_KEY is the "secret" (or legacy "service_role") key from
// Project Settings -> API Keys. Never put it in the website or commit it.

import { readFile } from 'node:fs/promises';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY environment variables.');
  process.exit(1);
}

const headers = { apikey: key, 'Content-Type': 'application/json' };
// Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys do not.
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

const existing = await fetch(`${url}/rest/v1/parks?select=id&limit=1`, { headers });
if (!existing.ok) throw new Error(`Could not read parks table: ${existing.status} ${await existing.text()}`);
if ((await existing.json()).length) {
  console.error('The parks table already has rows. Delete them first if you really want to reload.');
  process.exit(1);
}

const geojson = JSON.parse(await readFile(new URL('../data/parks.geojson', import.meta.url), 'utf8'));
const features = geojson.features;
const BATCH = 25;
let loaded = 0;

for (let i = 0; i < features.length; i += BATCH) {
  const res = await fetch(`${url}/rest/v1/rpc/load_parks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ features: features.slice(i, i + BATCH) }),
  });
  if (!res.ok) throw new Error(`Batch at ${i} failed: ${res.status} ${await res.text()}`);
  loaded += await res.json();
  process.stdout.write(`\rLoaded ${loaded} / ${features.length} parks`);
}
console.log('\nDone.');
