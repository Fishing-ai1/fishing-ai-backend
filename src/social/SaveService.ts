export type SaveInput = {
  contentId: string;
  userId: string;
  collectionName?: string | null;
};

export class SaveService {
  normalizeSave(input: SaveInput): Required<SaveInput> {
    if (!input.contentId) throw new Error("Content is required.");
    if (!input.userId) throw new Error("User is required.");
    return {
      contentId: input.contentId,
      userId: input.userId,
      collectionName: String(input.collectionName || "Saved").trim() || "Saved",
    };
  }
}
