export type ContentType =
  | "standard_post"
  | "catch_post"
  | "boat_post"
  | "video"
  | "short_video"
  | "trip_post"
  | "question_post"
  | "poll_post";

export type ContentVisibility = "public" | "followers" | "group" | "private";

export type CreateContentInput = {
  authorId: string;
  authorEmail?: string | null;
  contentType: ContentType;
  visibility?: ContentVisibility;
  title?: string | null;
  body?: string | null;
  generalLocation?: string | null;
  preciseLocationPrivate?: Record<string, unknown> | null;
  taggedSpecies?: string[];
  hashtags?: string[];
  metadata?: Record<string, unknown>;
};

export function assertSpotSafeContent(input: CreateContentInput) {
  if (input.visibility === "public" && input.preciseLocationPrivate) {
    throw new Error("Public social content cannot expose precise private coordinates.");
  }
}

export class ContentService {
  normalizeCreateInput(input: CreateContentInput): CreateContentInput {
    const next = {
      ...input,
      visibility: input.visibility || "public",
      taggedSpecies: input.taggedSpecies || [],
      hashtags: input.hashtags || [],
      metadata: input.metadata || {},
    };
    assertSpotSafeContent(next);
    return next;
  }
}
