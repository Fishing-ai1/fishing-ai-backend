import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {fixture,adapter,OWNER,MEMBER} from './fixture.ts';
import {registerLocationRoutes,eventLocation,validatedLocation} from '../src/platform/location-store.ts';
import {mergeLocation,marineDistance} from '../src/platform/localisation.ts';

test('country changes clear stale jurisdiction but preserve manual units; marine units are precise',()=>{
 const changed=mergeLocation({country:'US',subdivision:'FL',region:'Gulf',units:'metric',timezone:'America/New_York',latitude:25,longitude:-80},{country:'AU'});
 assert.equal(changed.units,'metric');assert.equal(changed.subdivision,null);assert.equal(changed.region,null);assert.equal(changed.latitude,25);
 assert.equal(marineDistance(1.852,'nm').value,1);assert.equal(marineDistance(1.609344,'mi').value,1);
});

test('regional records enforce ownership and registry, preserve unknown geography and support another country without code changes',async()=>{
 const pg=await fixture(),db=adapter(pg),app=Fastify();
 registerLocationRoutes(app,{db,enabled:true,auth:async req=>({id:req.headers['x-test-user']||OWNER})});
 const id='77777777-7777-4777-8777-777777777777';
 const request=(method:any,body?:any,user=OWNER)=>app.inject({method,url:'/api/platform/locations/catch/'+id,payload:body,headers:{'x-test-user':user}});
 try{
  await pg.query('insert into public.catches(id,user_id,lat,lng) values($1,$2,25,-80)',[id,OWNER]);
  let r=await request('GET');assert.equal(r.statusCode,200);assert.equal(r.json().location.country,null);assert.equal(r.json().location.latitude,25);
  assert.equal((await request('GET',undefined,MEMBER)).statusCode,404);
  assert.equal((await request('PATCH',{country:'AU',subdivision:'QLD'},MEMBER)).statusCode,404);
  r=await request('PATCH',{country:'US',subdivision:'FL',timezone:'America/New_York',latitude:25,longitude:-80,units:'metric'});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().location.units,'metric');
  assert.equal((await request('PATCH',{subdivision:'QLD'})).statusCode,400);
  assert.equal((await request('PATCH',{latitude:91})).statusCode,400);
  await assert.rejects(pg.query("update public.catches set subdivision='QLD' where id=$1",[id]));
  await pg.exec("insert into public.oc_countries values('NZ','New Zealand','metric',true);insert into public.oc_subdivisions values('NZ','AUK','Auckland',true)");
  r=await request('PATCH',{country:'NZ',subdivision:'AUK',timezone:'Pacific/Auckland'});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().location.latitude,25);
  assert.equal((await request('PATCH',{subdivision:'BAD'})).statusCode,400);
  assert.equal((await validatedLocation(db,{country:'US'})).units,'us_customary');
  await pg.query("insert into public.oc_user_preferences(user_id,country,subdivision,units,latitude,longitude) values($1,'US','FL','metric',25,-80)",[OWNER]);
  await pg.query("insert into public.oc_ai_requests(id,user_id,feature,reserved_tokens) values($1,$2,'regional-test',10)",[id,OWNER]);
  const requestRegion=(await pg.query('select country,subdivision,units,latitude,longitude from public.oc_ai_requests where id=$1',[id])).rows[0];
  assert.deepEqual(requestRegion,{country:'US',subdivision:'FL',units:'metric',latitude:null,longitude:null});
  assert.deepEqual(await eventLocation(db,true,{}),{});
  await assert.rejects(eventLocation(db,true,{location:{country:'US',latitude:1,longitude:2},lat:3,lng:4}));
  await assert.rejects(eventLocation(db,false,{location:{country:'AU'}}));
  const stored=(await pg.query('select lat,lng,country from public.catches where id=$1',[id])).rows[0];assert.equal(stored.lat,25);assert.equal(stored.country,'NZ');
 }finally{await app.close();await pg.close();}
});
