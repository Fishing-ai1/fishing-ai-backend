// ===========================================
// TEMP STUB: Vector Search (no Supabase)
// ===========================================

// For now, we are not using Supabase.
// This returns an empty list of memories so the AI still works.

export async function searchMemories(_embedding: number[], _count = 10) {
  console.warn("searchMemories stub called – no Supabase configured yet.");
  return [];
}
