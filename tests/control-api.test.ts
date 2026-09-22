import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { fixture,adapter,OWNER,MEMBER,MODERATOR } from './fixture.ts';
import { registerPlatform } from '../src/platform/routes.ts';
import { aiConfig } from '../src/platform/ai.ts';
test('Control API persists preferences and audited records, rejects unauthorized roles and mismatched jurisdictions',async()=>{
 const pg=await fixture(),app=Fastify();
 registerPlatform(app,{db:adapter(pg),enabled:true,owner:u=>u.id===OWNER,auth:async req=>({id:req.headers['x-test-user']||OWNER}),gateway:{config:aiConfig({})}});
 const request=(url:string,method:any='GET',payload?:any,user=OWNER)=>app.inject({url,method,payload,headers:{'x-test-user':user}});
 try{
  const denied=await request('/admin/control/catches/'+MEMBER+'/photo','POST',{reason:'Test private access'},MODERATOR);assert.equal(denied.statusCode,403);
  let r=await request('/api/platform/preferences','PATCH',{country:'US',subdivision:'FL',units:'us_customary',waters:'state',ai_personal_context:true},MEMBER);assert.equal(r.statusCode,200,r.body);
  assert.equal(r.json().preferences.user_id,MEMBER);assert.equal(r.json().preferences.units,'us_customary');
  r=await request('/api/platform/preferences','PATCH',{marine_distance_unit:'nm'},MEMBER);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().preferences.marine_distance_unit,'nm');
  r=await request('/api/platform/preferences','PATCH',{marine_distance_unit:'furlongs'},MEMBER);assert.equal(r.statusCode,400);
  r=await request('/admin/control/users','GET',undefined,MODERATOR);assert.equal(r.statusCode,403);
  r=await request('/admin/control/list/moderation','GET',undefined,MODERATOR);assert.equal(r.statusCode,200);
  r=await request('/admin/control/users');assert.equal(r.statusCode,200,r.body);assert.equal(r.json().total,3);
  r=await request('/admin/control/records','POST',{reason:'Testing record persistence',record:{kind:'species',name:'Test fish',canonical_key:'test-fish',country:'AU',units:'us_customary',waters:'inland'}});assert.equal(r.statusCode,200,r.body);
  assert.equal(r.json().record.units,'us_customary');assert.equal(r.json().record.waters,'inland');
  r=await request('/admin/control/list/records');assert.equal(r.json().rows[0].name,'Test fish');
  r=await request('/admin/control/list/audit');assert.equal(r.json().rows[0].action,'record.save');
  r=await request('/admin/control/dashboard');assert.equal(r.statusCode,200,r.body);assert.equal(r.json().metrics.total_users,3);
  r=await request('/admin/control/users/'+MEMBER+'/timeline');assert.equal(r.statusCode,200,r.body);assert.equal(r.json().events[0].event,'signup');
  r=await request('/admin/control/knowledge','POST',{reason:'Invalid regulation test',record:{kind:'regulation',title:'Test rule',body:'Test only',trust:'official',status:'approved',country:'US'}});assert.equal(r.statusCode,400);
  r=await request('/admin/control/users/'+MEMBER+'/role','PATCH',{role:'owner',reason:'Escalation test',confirmation:MEMBER},MODERATOR);assert.equal(r.statusCode,403);
  r=await request('/api/platform/preferences','PATCH',{country:'AU',subdivision:'FL'},MEMBER);assert.equal(r.statusCode,400);
 }finally{await app.close();await pg.close();}
});

test('private admin photo links require a durable audit, permission and reason',async()=>{
 const pg=await fixture(),app=Fastify(),db=adapter(pg); let signed=0;
 const catchId='55555555-5555-4555-8555-555555555555';
 db.storage={getBucket:async()=>({data:{public:false}}),from:()=>({createSignedUrl:async()=>{signed++;return {data:{signedUrl:'https://example.test/temporary-photo'}};}})};
 registerPlatform(app,{db,enabled:true,owner:u=>u.id===OWNER,auth:async req=>({id:req.headers['x-test-user']||OWNER}),gateway:{config:aiConfig({})}});
 const request=(user=OWNER,reason='Investigating an owner support request')=>app.inject({method:'POST',url:'/admin/control/catches/'+catchId+'/photo',headers:{'x-test-user':user},payload:{reason}});
 try {
  await pg.exec('alter table public.catches add column photo_url text');
  await pg.query('insert into public.catches(id,user_id,photo_url) values($1,$2,$3)',[catchId,MEMBER,'oc-catch:'+MEMBER+'/'+catchId+'.jpg']);
  assert.equal((await request(MODERATOR)).statusCode,403);
  assert.equal((await request(MEMBER)).statusCode,403);
  assert.equal((await request(OWNER,'')).statusCode,400);
  assert.equal(signed,0);
  const response=await request();assert.equal(response.statusCode,200,response.body);
  assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.json().expires_in,300);
  const rows=(await pg.query("select actor_id,target_id,reason from public.oc_audit where action='private.photo.view'")).rows;
  assert.deepEqual(rows,[{actor_id:OWNER,target_id:catchId,reason:'Investigating an owner support request'}]);
  await pg.exec("create function public.fail_photo_audit() returns trigger language plpgsql as $$begin raise exception 'Test audit outage';end$$;create trigger test_photo_audit_failure before insert on public.oc_audit for each row execute function public.fail_photo_audit()");
  assert.equal((await request()).statusCode,503);
  assert.equal(signed,1,'An audit outage must prevent issuing another signed link');
 } finally {await app.close();await pg.close();}
});
