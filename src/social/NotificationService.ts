export type NotificationInput = {
  userId: string;
  actorId?: string | null;
  type: string;
  targetType?: string | null;
  targetId?: string | null;
  title?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown>;
};

export class NotificationService {
  normalizeNotification(input: NotificationInput): NotificationInput {
    if (!input.userId) throw new Error("Notification user is required.");
    if (!input.type) throw new Error("Notification type is required.");
    return { ...input, metadata: input.metadata || {} };
  }
}
