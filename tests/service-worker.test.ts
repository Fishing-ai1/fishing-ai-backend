import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
test('service worker does not cache authenticated or sensitive API responses',()=>{
 const handlers:any={};const context={URL,self:{registration:{scope:'https://oceancore.example/'},location:{origin:'https://oceancore.example'},addEventListener:(type:string,fn:any)=>handlers[type]=fn}};
 vm.runInNewContext(fs.readFileSync('../fishing-ai-frontend/sw.js','utf8'),context);
 for(const path of ['/admin/control/users','/ai/chat/sessions','/saved-areas','/api/platform/preferences','/community/posts','/auth/me']){
  let cached=false;handlers.fetch({request:{method:'GET',url:'https://oceancore.example'+path,headers:{has:()=>false}},respondWith:()=>cached=true});assert.equal(cached,false,path);
 }
 let cached=false;handlers.fetch({request:{method:'GET',url:'https://oceancore.example/anything',headers:{has:()=>true}},respondWith:()=>cached=true});assert.equal(cached,false);
});
