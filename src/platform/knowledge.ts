import type { LocationContext } from './localisation.ts';
export function eligibleKnowledge(row: any, context: LocationContext, now = Date.now()) {
  if (row.status !== 'approved' || !['official', 'verified'].includes(row.trust) || row.visibility !== 'public') return false;
  if(!row.source_id || !/^https:\/\//.test(row.source_url || '') || !Number.isFinite(Date.parse(row.checked_at)) || Date.parse(row.checked_at)>now || !Number.isFinite(Date.parse(row.review_due_at)) || Date.parse(row.review_due_at)<=now)return false;
  if (row.country && row.country !== context.country) return false;
  if (row.subdivision && row.subdivision !== context.subdivision) return false;
  if (row.region && row.region !== context.region) return false;
  if (row.marine_region && row.marine_region !== context.marine_region) return false;
  if (row.waters && row.waters !== context.waters) return false;
  if (row.effective_from && Date.parse(row.effective_from) > now) return false;
  if (row.effective_until && Date.parse(row.effective_until) <= now) return false;
  if (row.kind === 'regulation') {
    if (row.trust !== 'official' || !row.country || !row.waters || !row.source_url || !row.effective_from || !row.checked_at || !row.review_due_at) return false;
    if (!context.country || !context.waters || (['state','inland'].includes(context.waters) && !context.subdivision)) return false;
    if (!Number.isFinite(Date.parse(row.review_due_at)) || Date.parse(row.review_due_at) <= now || Date.parse(row.checked_at) > now) return false;
  }
  return true;
}
export async function retrieveKnowledge(db: any, question: string, context: LocationContext) {
  const { data, error } = await db.rpc('oc_search_knowledge', { p_query: question.slice(0, 2000), p_country: context.country, p_subdivision: context.subdivision, p_region: context.region, p_marine: context.marine_region, p_waters: context.waters, p_limit: 12 });
  if (error) throw new Error('Knowledge retrieval unavailable.');
  return (data || []).filter((row: any) => eligibleKnowledge(row, context));
}
// Use only consented, verified observations. No individual rows or arbitrary time slices are returned.
export function aggregateObservations(rows: any[], minUsers = 10, minSamples = 30) {
  const groups = new Map<string, any[]>(), seen = new Set<string>();
  for (const r of rows) {
    if (!r.share_for_patterns || r.verification_status !== 'verified' || !r.id || !r.user_id || !r.species_id || seen.has(r.id) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng) || Math.abs(r.lat) > 90 || Math.abs(r.lng) > 180) continue;
    seen.add(r.id);
    const month = String(r.created_at || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    // Fixed half-degree cells; no exact coordinates or per-user contribution export.
    const key = `${Math.floor(r.lat * 2) / 2}:${Math.floor(r.lng * 2) / 2}:${month}:${r.species_id}`;
    const group = groups.get(key) || []; group.push(r); groups.set(key, group);
  }
  return [...groups.entries()].flatMap(([cell, group]) => {
    const users = new Set(group.map(r => r.user_id));
    const maxContribution = Math.max(...[...users].map(u => group.filter(r => r.user_id === u).length));
    if (users.size < Math.max(10, minUsers) || group.length < Math.max(30, minSamples) || maxContribution / group.length > 0.2) return [];
    return [{ cell, samples: Math.floor(group.length / 10) * 10, contributors: Math.floor(users.size / 5) * 5, confidence: 'observational', interpretation: 'Recorded catches; not an estimate of catch probability.' }];
  });
}
