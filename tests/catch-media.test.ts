import test from 'node:test';
import assert from 'node:assert/strict';
import { catchMediaKey, uploadCatchMedia, signCatchMedia, CATCH_BUCKET } from '../src/platform/catch-media.ts';
const owner='11111111-1111-4111-8111-111111111111';
const key=owner+'/22222222-2222-4222-8222-222222222222.jpg';
test('catch references bind to owner and exact trusted signed-storage origin',()=>{
  assert.equal(catchMediaKey('oc-catch:'+key,owner),key);
  assert.equal(catchMediaKey(`https://test.supabase.co/storage/v1/object/sign/${CATCH_BUCKET}/${key}?token=example`,owner,'https://test.supabase.co'),key);
  for(const value of ['oc-catch:'+key.replace(owner,'33333333-3333-4333-8333-333333333333'),'oc-catch:'+owner+'/../secret.jpg','https://evil.example/'+key,'/media/old.jpg']) assert.throws(()=>catchMediaKey(value,owner,'https://test.supabase.co'));
});
test('private uploads and five-minute links fail closed for public or unavailable storage',async()=>{
  let publicBucket=false; const calls:any[]=[];
  const db={storage:{getBucket:async()=>({data:{public:publicBucket}}),from:(bucket:string)=>({upload:async(...args:any[])=>{calls.push([bucket,...args]);return {};},createSignedUrl:async(path:string,seconds:number)=>{calls.push([path,seconds]);return {data:{signedUrl:'https://test.example/signed'}};}})}};
  const ref=await uploadCatchMedia(db,owner,Buffer.from('verified upstream'),'image/jpeg','jpg');
  assert.ok(ref.startsWith('oc-catch:'+owner+'/'));
  assert.equal(calls[0][3].upsert,false);
  assert.equal(await signCatchMedia(db,ref,owner),'https://test.example/signed');
  assert.equal(calls[1][1],300);
  publicBucket=true;
  await assert.rejects(uploadCatchMedia(db,owner,Buffer.from('x'),'image/jpeg','jpg'));
  await assert.rejects(signCatchMedia(db,ref,owner));
  await assert.rejects(uploadCatchMedia(null,owner,Buffer.from('x'),'image/jpeg','jpg'));
  assert.equal(calls.length,2);
});
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
test('storage migration blocks broad legacy browser policies while leaving other buckets usable',async()=>{
 const pg=new PGlite();
 try {
  await pg.exec(`create role anon;create role authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;create policy legacy_open on storage.objects for all to authenticated using(true) with check(true);`);
  await pg.exec(fs.readFileSync('supabase/migrations/20260909072323_oceancore_private_catch_storage.sql','utf8'));
  await pg.exec("insert into storage.objects values ('oceancore-private-catches'),('public-avatars');set role authenticated");
  assert.deepEqual((await pg.query('select bucket_id from storage.objects')).rows,[{bucket_id:'public-avatars'}]);
  await assert.rejects(pg.exec("insert into storage.objects values ('oceancore-private-catches')"));
 } finally {await pg.close();}
});
