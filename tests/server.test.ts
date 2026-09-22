import test from 'node:test';
import assert from 'node:assert/strict';
// Import the real server without connecting to production or opening a listening socket.
process.env.OCEANCORE_TEST_MODE='true';process.env.OCEANCORE_PLATFORM_ENABLED='false';
process.env.SUPABASE_URL=' ';process.env.SUPABASE_SERVICE_KEY=' ';process.env.SUPABASE_ANON_KEY=' ';process.env.OPENAI_API_KEY=' ';
test('existing backend boots and private mutation / AI routes fail closed',async()=>{
 const {app}=await import('../server.ts');
 try{
  await app.ready();
  for(const url of ['/ai/chat/smart','/ai/species-detect','/api/boat/briefing','/catches','/community/posts']){
   const r=await app.inject({method:'POST',url,payload:{question:'Test'}});
   assert.ok([401,503].includes(r.statusCode),`${url}: ${r.statusCode}`);
  }
  const platform=await app.inject({method:'GET',url:'/api/platform/status'});assert.equal(platform.statusCode,200);assert.equal(platform.json().connected,false);
  const admin=await app.inject({method:'GET',url:'/admin/control/me'});assert.equal(admin.statusCode,503);
  const frontend=await app.inject({method:'GET',url:'/app/control-centre.html'});assert.equal(frontend.statusCode,200);assert.match(frontend.body,/CONTROL CENTRE/);
  const settings=await app.inject({method:'GET',url:'/app/regional-settings.html'});assert.equal(settings.statusCode,200);
 }finally{await app.close();}
});
