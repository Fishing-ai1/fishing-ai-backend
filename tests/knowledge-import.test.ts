import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {fixture,adapter,OWNER} from './fixture.ts';
import {registerPlatform} from '../src/platform/routes.ts';
import {aiConfig} from '../src/platform/ai.ts';
import {prepareKnowledgeImport,validateCatalogAttributes} from '../src/platform/knowledge-import.ts';
test('reviewed imports reject unlicensed, spoofed, stale and mismatched evidence',()=>{
 const source={licence_approved:true,country:'AU',subdivision:'QLD',allowed_hosts:['www.qld.gov.au'],review_interval_hours:24};
 const item={kind:'marine',title:'Synthetic test',body:'Synthetic test evidence only.',country:'AU',subdivision:'QLD',source_url:'https://www.qld.gov.au/test',checked_at:new Date().toISOString()};
 assert.equal(prepareKnowledgeImport(source,{items:[item]}).length,1);
 for(const bad of [{source_url:'https://www.qld.gov.au.evil.test/test'},{country:'US',subdivision:'FL'},{checked_at:'2020-01-01'},{kind:'regulation'}])assert.throws(()=>prepareKnowledgeImport(source,{items:[{...item,...bad}]}));
 assert.throws(()=>prepareKnowledgeImport({...source,licence_approved:false},{items:[item]}));
 assert.throws(()=>validateCatalogAttributes({kind:'boat',attributes:{length_m:-1}}));
 assert.throws(()=>validateCatalogAttributes({kind:'outboard',attributes:{rpm_min:6000,rpm_max:4000}}));
});
test('knowledge import is audited, idempotent and remains excluded until review; aliases respect country',async()=>{
 const pg=await fixture(),app=Fastify();
 registerPlatform(app,{db:adapter(pg),enabled:true,owner:u=>u.id===OWNER,auth:async()=>({id:OWNER}),gateway:{config:aiConfig({})}});
 const req=(url:string,payload:any,method:any='POST')=>app.inject({url,method,payload});
 try{
 const item={kind:'marine',title:'Synthetic QLD evidence',body:'Synthetic pelagic evidence for tests only.',country:'AU',subdivision:'QLD',source_url:'https://www.qld.gov.au/test',checked_at:new Date().toISOString()};
 const body={source_id:'au-qld-fisheries',items:[item],reason:'Synthetic import test'};
 assert.equal((await req('/admin/control/knowledge/import',body)).statusCode,409);
 let r=await req('/admin/control/sources/au-qld-fisheries/policy',{licence_approved:true,licence_url:'https://example.test/test-only-licence',review_interval_hours:24,reason:'Synthetic permission fixture'},'PATCH');assert.equal(r.statusCode,200,r.body);
 r=await req('/admin/control/knowledge/import',body);assert.equal(r.statusCode,200,r.body);
 r=await req('/admin/control/knowledge/import',body);assert.equal(r.statusCode,200,r.body);
 assert.equal((await pg.query("select count(*)::int n from oc_knowledge_imports")).rows[0].n,1);
 assert.equal((await pg.query("select status from oc_knowledge where title='Synthetic QLD evidence'")).rows[0].status,'draft');
 const search=async(q:string,country:string)=>(await pg.query("select * from oc_search_knowledge($1,$2,null,null,null,null,12)",[q,country])).rows;
 assert.equal((await search('Pagrus auratus habitat','AU')).length,1);
 assert.equal((await search('Pagrus auratus habitat','US')).length,0);
 assert.equal((await search('dolphinfish','US')).length,1);
 assert.equal((await search('Synthetic pelagic','AU')).length,0);
 await pg.exec("update oc_knowledge set review_due_at=now()-interval '1 second' where country='AU'");
 assert.equal((await search('Pagrus auratus','AU')).length,0);
 assert.equal((await pg.query("select count(*)::int n from oc_audit where action='knowledge.import'")).rows[0].n,2);
 }finally{await app.close();await pg.close();}
});

