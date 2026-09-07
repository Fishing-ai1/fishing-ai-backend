export type ReactionType = "like" | "nice_catch" | "helpful" | "congrats";

export class ReactionService {
  normalizeReaction(type: unknown): ReactionType {
    const value = String(type || "like").trim().toLowerCase();
    if (["nice_catch", "helpful", "congrats"].includes(value)) return value as ReactionType;
    return "like";
  }
}
