export type FeedCandidate = {
  id: string;
  authorId?: string | null;
  contentType?: string | null;
  createdAt?: string | Date | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  savesCount?: number | null;
  viewsCount?: number | null;
  generalLocation?: string | null;
  taggedSpecies?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type FeedRankingContext = {
  followedAuthorIds?: Set<string>;
  preferredSpecies?: Set<string>;
  preferredLocations?: Set<string>;
  now?: Date;
};

function ageHours(createdAt: FeedCandidate["createdAt"], now: Date) {
  if (!createdAt) return 240;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 240;
  return Math.max(0, (now.getTime() - created.getTime()) / 36e5);
}

export class FeedRankingService {
  score(candidate: FeedCandidate, context: FeedRankingContext = {}) {
    const now = context.now ?? new Date();
    const freshness = 40 * Math.exp(-ageHours(candidate.createdAt, now) / 72);
    const engagement =
      Math.log1p(Math.max(0, Number(candidate.likesCount || 0))) * 6 +
      Math.log1p(Math.max(0, Number(candidate.commentsCount || 0))) * 9 +
      Math.log1p(Math.max(0, Number(candidate.savesCount || 0))) * 8 +
      Math.log1p(Math.max(0, Number(candidate.viewsCount || 0))) * 2;
    const followed = candidate.authorId && context.followedAuthorIds?.has(candidate.authorId) ? 25 : 0;
    const speciesMatch = (candidate.taggedSpecies || []).some((name) => context.preferredSpecies?.has(name)) ? 12 : 0;
    const locationMatch =
      candidate.generalLocation && context.preferredLocations?.has(candidate.generalLocation) ? 10 : 0;
    return freshness + engagement + followed + speciesMatch + locationMatch;
  }

  rank<T extends FeedCandidate>(candidates: T[], context: FeedRankingContext = {}) {
    return [...candidates].sort((a, b) => this.score(b, context) - this.score(a, context));
  }

  diversify<T extends { authorId?: string | null }>(ranked: T[]) {
    const remaining = [...ranked];
    const result: T[] = [];
    while (remaining.length) {
      const recentAuthors = new Set(result.slice(-2).map((item) => item.authorId).filter(Boolean));
      const next = remaining.findIndex((item) => !item.authorId || !recentAuthors.has(item.authorId));
      result.push(remaining.splice(next < 0 ? 0 : next, 1)[0]);
    }
    return result;
  }
}
