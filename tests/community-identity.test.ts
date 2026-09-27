import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCommunityAuthors } from '../community-identity.ts';

test('historical posts resolve the current author name in one batch without changing stored content', async () => {
  const posts = [{user_id:'a', author_name:'Old name'}, {user_id:'a',author_name:'Older name'}, {user_id:'b',author_name:'Missing profile'}];
  let calls = 0;
  const result = await hydrateCommunityAuthors(posts, async ids => {
    calls++; assert.deepEqual(ids, ['a','b']);
    return [{id:'a',full_name:'New name'}];
  });
  assert.equal(calls,1);
  assert.deepEqual(result.map(p=>p.author_name), ['New name','New name','Missing profile']);
  assert.equal(posts[0].author_name,'Old name');
});
test('blank names use username or a public generic name, never email', async () => {
  const result = await hydrateCommunityAuthors([{user_id:'a'}, {user_id:'b'}], async () => [
    {id:'a',full_name:' ',username:'angler'}, {id:'b',full_name:null}
  ]);
  assert.deepEqual(result.map(p=>p.author_name),['angler','OceanCore member']);
});
