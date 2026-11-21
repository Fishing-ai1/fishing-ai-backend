import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

const marker = 'fixture-only-private-field';
const id = '11111111-1111-4111-8111-111111111111';
const admin = '22222222-2222-4222-8222-222222222222';
const origin = 'https://fixture.invalid';
const authUser = {
  id, email: 'member@example.test', user_metadata: { admin_notes: marker, username: 'angler' },
  identities: [{ identity_data: { admin_notes: marker, provider_field: true } }],
};
function token(claims: object) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode(claims);
  return body + '.' + createHmac('sha256', 'fixture-only').update(body).digest('base64url');
}
const clean = token({ sub: id, user_metadata: { admin_notes: null } });
let issued: string | null;
let missNextProfileRead: boolean;
let profile: Record<string, any>;
let metadataWrites: any[], profileWrites: any[], bans: any[];
const fetchBefore = globalThis.fetch;
let app: typeof import('../server.ts').app;
before(async () => {
  Object.assign(process.env, {
    SUPABASE_URL: origin, SUPABASE_SERVICE_KEY: 'fixture-service', SUPABASE_ANON_KEY: 'fixture-anon',
    OCEANCORE_TEST_MODE: 'true', OCEANCORE_PLATFORM_ENABLED: 'false', ADMIN_USER_IDS: admin, OPENAI_API_KEY: ' ',
  });
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    assert.equal(url.origin, origin);
    const body = req.body ? await req.json() : {};
    const json = (v: any) => Response.json(v);
    if (url.pathname === '/auth/v1/user') {
      if (req.method === 'PUT') return json({ user: authUser });
      return json(req.headers.get('authorization') === 'Bearer admin-fixture' ? { ...authUser, id: admin } : authUser);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      if (body.user_metadata) metadataWrites.push(body.user_metadata);
      if (body.ban_duration) bans.push(body.ban_duration);
      return json(authUser);
    }
    if (['/auth/v1/token','/auth/v1/signup','/auth/v1/verify'].includes(url.pathname)) {
      return json(issued === null ? { user: authUser } : { user: authUser, access_token: issued,
        refresh_token: 'fixture-refresh', expires_in: 900, expires_at: 12345, token_type: 'bearer' });
    }
    if (url.pathname === '/rest/v1/profiles') {
      if (missNextProfileRead && req.method === 'GET' && url.searchParams.get('select') !== 'account_status') {
        missNextProfileRead = false;
        return json([]);
      }
      if (req.method !== 'GET') {
        profileWrites.push(body);
        profile = { ...profile, ...body };
      }
      const row = url.searchParams.get('select') === 'account_status' ? { account_status: 'active' } : profile;
      return json(req.method === 'GET' && !req.headers.get('accept')?.includes('object') ? [row] : row);
    }
    if (url.pathname === '/rest/v1/audit_log') return json(body);
    if (['account_settings','oc_products','oc_entitlements','usage_daily'].includes(url.pathname.split('/').pop()!)) return json([]);
    throw new Error('Unexpected fixture request ' + url.pathname);
  };
  ({ app } = await import('../server.ts'));
  await app.ready();
});
beforeEach(() => {
  issued = clean;
  missNextProfileRead = false;
  profile = { id, email: authUser.email, admin_notes: marker, stripe_customer_id: 'cus_fixture', plan: 'free', username: 'angler' };
  metadataWrites = []; profileWrites = []; bans = [];
});
after(async () => { try { await app?.close(); } finally { globalThis.fetch = fetchBefore; } });
const authRoutes = [
  ['/auth/login',{ email: authUser.email, password: 'fixture-password' }],
  ['/auth/signup',{ email: authUser.email, password: 'fixture-password' }],
  ['/auth/refresh',{ refresh_token: 'fixture-refresh' }],
  ['/auth/verify-recovery',{ token_hash: 'fixture-recovery-token' }],
] as const;
function safeUser(user: any) {
  assert.deepEqual(user, { id, email: authUser.email, user_metadata: { username: 'angler' },
    identities: [{ identity_data: { provider_field: true } }] });
}
for (const [url, payload] of authRoutes) {
  test(url + ' preserves clean session bytes and both user shapes', async () => {
    const res = await app.inject({ method: 'POST', url, payload });
    assert.equal(res.statusCode, 200);
    const { user, session } = res.json();
    safeUser(user); safeUser(session.user);
    assert.deepEqual({ ...session, user: null }, { access_token: clean, refresh_token: 'fixture-refresh',
      expires_in: 900, expires_at: 12345, token_type: 'bearer', user: null });
  });
  test(url + ' withholds tainted or unreadable signed claims and refresh token', async () => {
    for (const access of [token({ user_metadata: { admin_notes: marker } }),
      token({ raw_user_meta_data: { admin_notes: marker } }), 'opaque-fixture']) {
      issued = access;
      const res = await app.inject({ method: 'POST', url, payload });
      assert.equal(res.statusCode, 503);
      assert.deepEqual(Object.keys(res.json()).sort(), ['error', 'success']);
      for (const secret of [marker, access, 'fixture-refresh']) assert.equal(res.body.includes(secret), false);
    }
  });
}
test('confirmation-only signup and password update preserve provider user fields', async () => {
  issued = null;
  const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: authRoutes[1][1] });
  assert.equal(signup.statusCode, 200);
  assert.equal(signup.json().session, null); assert.equal(signup.json().email_confirmation_required,true);
  safeUser(signup.json().user);
  const update = await app.inject({ method:'POST', url:'/auth/update-password', headers:{ authorization:'Bearer fixture' },
    payload:{ password:'fixture-password' } });
  assert.equal(update.statusCode,200); safeUser(update.json().user);
});
const memberRoutes = [
  ['GET','/auth/me'], ['GET','/auth/profile'], ['PATCH','/auth/profile',{ username:'edited' }],
  ['PATCH','/auth/email',{ email:'updated@example.test' }], ['POST','/auth/accept-legal',{}],
  ['POST','/auth/avatar',{ avatar_data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4oYoAAAAASUVORK5CYII=' }],
  ['GET','/billing/me'],
] as const;
test('first-read miss and conflicting upsert cannot send a null note over a newly created profile', async () => {
  missNextProfileRead = true;
  const res = await app.inject({ method: 'GET', url: '/auth/profile', headers: { authorization: 'Bearer fixture' } });
  assert.equal(res.statusCode, 200);
  assert.equal(profileWrites.length, 1);
  assert.equal(Object.hasOwn(profileWrites[0], 'admin_notes'), false);
  assert.equal(profile.admin_notes, marker);
  assert.equal(res.body.includes(marker), false);
});
for (const [method,url,payload] of memberRoutes) test(method+' '+url+' omits notes and protects stored evidence', async () => {
  const res = await app.inject({ method, url, payload, headers:{ authorization:'Bearer fixture' } });
  assert.equal(res.statusCode,200);
  const dto = res.json();
  try {
    assert.equal(dto.profile.id,id);
    assert.equal(dto.profile.stripe_customer_id,'cus_fixture');
    assert.equal(res.body.includes(marker),false);
    assert.equal(Object.hasOwn(dto.profile,'admin_notes'),false);
    assert.ok(metadataWrites.length);
    for(const write of metadataWrites) {
      assert.equal(Object.hasOwn(write,'admin_notes'),false); assert.ok(Object.hasOwn(write,'username'));
    }
    for(const write of profileWrites) assert.equal(Object.hasOwn(write,'admin_notes'),false);
    assert.equal(profile.admin_notes,marker);
  } finally {
    if (url==='/auth/avatar' && dto.avatar_url) await unlink(path.join('uploads',path.basename(new URL(dto.avatar_url).pathname)));
  }
});
for (const [method,action,duration] of [['PATCH','status','none'],['POST','suspend','876000h'],['POST','unsuspend','none']] as const) {
  test('admin '+action+' preserves authorized notes and ban operation without Auth replication', async () => {
    const res = await app.inject({method,url:'/admin/users/'+id+'/'+action,headers:{authorization:'Bearer admin-fixture'},
      payload:{ admin_notes:marker,account_status:'active' }});
    assert.equal(res.statusCode,200);
    assert.equal(res.json().profile.admin_notes,marker);
    assert.ok(metadataWrites.length >= 2);
    for(const write of metadataWrites) assert.equal(Object.hasOwn(write,'admin_notes'),false);
    assert.deepEqual(bans,[duration]);
  });
}
