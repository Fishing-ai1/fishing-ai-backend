export function messageNeedsReview(body: string) {
  return /https?:\/\/|www\.|\b(?:crypto|gift card|wire transfer|password|verification code|recovery phrase)\b/i.test(body);
}

export class MessageRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private limit = 20, private windowMs = 10 * 60 * 1000) {}

  reserve(userId: string, now = Date.now()) {
    if (this.buckets.size > 5000) {
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }
    const bucket = this.buckets.get(userId);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(userId, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    if (bucket.count >= this.limit) return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    bucket.count += 1;
    return 0;
  }
}
