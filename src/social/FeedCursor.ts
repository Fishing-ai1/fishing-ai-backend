export type FeedCursor = {
  scope: string;
  beforeAt: string;
  beforeId: string;
  pending: { id: string; score: number }[];
  more: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeFeedCursor(cursor: FeedCursor) {
  return Buffer.from(JSON.stringify([
    1, cursor.scope, cursor.beforeAt, cursor.beforeId,
    cursor.pending.map(item => [item.id, Math.round(item.score * 100) / 100]), cursor.more,
  ])).toString('base64url');
}

export function decodeFeedCursor(raw: string, scope: string): FeedCursor {
  if (!raw || raw.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Invalid feed cursor.');
  try {
    const data = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      !Array.isArray(data) || data.length !== 6 || data[0] !== 1 || data[1] !== scope ||
      typeof data[2] !== 'string' || !Number.isFinite(Date.parse(data[2])) ||
      !uuid.test(data[3]) || typeof data[5] !== 'boolean' ||
      !Array.isArray(data[4]) || data[4].length > 48 ||
      !data[4].every((item: any) => Array.isArray(item) && item.length === 2 && uuid.test(item[0]) &&
        typeof item[1] === 'number' && Number.isFinite(item[1])) ||
      new Set(data[4].map((item: any) => item[0])).size !== data[4].length
    ) throw new Error();
    return {
      scope, beforeAt: data[2], beforeId: data[3],
      pending: data[4].map(([id, score]: [string, number]) => ({ id, score })), more: data[5],
    };
  } catch {
    throw new Error('Invalid feed cursor.');
  }
}
