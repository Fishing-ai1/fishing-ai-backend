import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedRankingService } from '../src/social/FeedRankingService.ts';
import { MessageRateLimiter, messageNeedsReview } from '../src/social/MessageSafety.ts';

test('feed engagement has diminishing returns and follows influence ranking', () => {
  const service = new FeedRankingService();
  const now = new Date('2026-10-24T00:00:00Z');
  const base = { id: 'a', authorId: 'a', createdAt: now, likesCount: 0 };
  const score = (likesCount: number) => service.score({ ...base, likesCount }, { now });
  assert.ok(score(10) > score(0));
  assert.ok(score(100) - score(10) < score(10) - score(0));
  assert.ok(service.score(base, { now, followedAuthorIds: new Set(['a']) }) > score(10));
});

test('feed diversification avoids runs of one author without dropping posts', () => {
  const service = new FeedRankingService();
  const posts = [
    { id: 'a1', authorId: 'a' }, { id: 'a2', authorId: 'a' },
    { id: 'a3', authorId: 'a' }, { id: 'b1', authorId: 'b' },
  ];
  const result = service.diversify(posts);
  assert.deepEqual(result.map((post) => post.id), ['a1', 'b1', 'a2', 'a3']);
  assert.deepEqual(posts.map((post) => post.id), ['a1', 'a2', 'a3', 'b1']);
});

test('message controls hold risky text and throttle each account independently', () => {
  assert.equal(messageNeedsReview('Meet at the ramp tomorrow'), false);
  assert.equal(messageNeedsReview('Send your verification code'), true);
  assert.equal(messageNeedsReview('See https://example.test'), true);
  const limiter = new MessageRateLimiter(2, 1000);
  assert.equal(limiter.reserve('a', 0), 0);
  assert.equal(limiter.reserve('a', 1), 0);
  assert.equal(limiter.reserve('b', 2), 0);
  assert.equal(limiter.reserve('a', 3), 1);
  assert.equal(limiter.reserve('a', 1000), 0);
});
