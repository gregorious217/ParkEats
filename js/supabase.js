import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT');

export const sb = createClient(
  isConfigured ? SUPABASE_URL : 'https://example.supabase.co',
  isConfigured ? SUPABASE_ANON_KEY : 'not-configured',
  {
    auth: {
      // Implicit flow lets the emailed link work even if it opens in a different browser.
      flowType: 'implicit',
      detectSessionInUrl: true,
      persistSession: true,
    },
  },
);

// PostgREST returns at most 1000 rows per request; page through larger tables.
export async function fetchAll(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}
