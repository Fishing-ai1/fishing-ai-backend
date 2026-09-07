export type FollowTargetType = "user" | "creator" | "boat" | "business" | "group" | "topic";

export type FollowEdge = {
  followerId: string;
  targetType: FollowTargetType;
  targetId: string;
  status?: "active" | "muted" | "blocked" | "pending";
};

export class SocialGraphService {
  normalizeFollow(edge: FollowEdge): FollowEdge {
    if (!edge.followerId) throw new Error("Follower is required.");
    if (!edge.targetId) throw new Error("Follow target is required.");
    if (!edge.targetType) throw new Error("Follow target type is required.");
    return { ...edge, status: edge.status || "active" };
  }
}
