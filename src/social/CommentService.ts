export type CreateCommentInput = {
  contentId: string;
  userId: string;
  body: string;
  parentCommentId?: string | null;
};

export class CommentService {
  normalizeCreateInput(input: CreateCommentInput): CreateCommentInput {
    const body = String(input.body || "").trim();
    if (!input.contentId) throw new Error("Content is required.");
    if (!input.userId) throw new Error("User is required.");
    if (body.length < 1) throw new Error("Comment cannot be empty.");
    if (body.length > 2000) throw new Error("Comment is too long.");
    return { ...input, body };
  }
}
