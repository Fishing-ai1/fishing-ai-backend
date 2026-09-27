export async function hydrateCommunityAuthors<T extends { user_id: string; author_name?: string }>(
  rows: T[], load: (ids: string[]) => Promise<Array<{ id: string; full_name?: string | null; username?: string | null }>>,
): Promise<T[]> {
  const ids = [...new Set(rows.map(row => row.user_id).filter(Boolean))];
  if (!ids.length) return rows;
  const profiles = await load(ids);
  const names = new Map(profiles.map(profile => [String(profile.id),
    profile.full_name?.trim() || profile.username?.trim() || "OceanCore member"]));
  return rows.map(row => names.has(row.user_id) ? { ...row, author_name: names.get(row.user_id)! } : row);
}
