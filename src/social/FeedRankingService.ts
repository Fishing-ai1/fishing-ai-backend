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
    const freshness = Math.max(0, 40 - ageHours(candidate.createdAt, now) * 0.9);
    const engagement =
      Number(candidate.likesCount || 0) * 2 +
      Number(candidate.commentsCount || 0) * 4 +
      Number(candidate.savesCount || 0) * 3 +
      Math.log10(Number(candidate.viewsCount || 0) + 1) * 6;
    const followed = candidate.authorId && context.followedAuthorIds?.has(candidate.authorId) ? 25 : 0;
    const speciesMatch = (candidate.taggedSpecies || []).some((name) => context.preferredSpecies?.has(name)) ? 12 : 0;
    const locationMatch =
      candidate.generalLocation && context.preferredLocations?.has(candidate.generalLocation) ? 10 : 0;
    return freshness + engagement + followed + speciesMatch + locationMatch;
  }

  rank<T extends FeedCandidate>(candidates: T[], context: FeedRankingContext = {}) {
    return [...candidates].sort((a, b) => this.score(b, context) - this.score(a, context));
  }
}
