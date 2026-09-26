import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

test('auth email redirects use the provider query parameter and preserve payloads', async () => {
  const source=fs.readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function callSupabaseAuth('),source.indexOf('function formatSessionPayload('));
  const requests:any[]=[];
  const context:any={
    URL, SUPABASE_URL:'https://auth.example.test', SUPABASE_AUTH_API_KEY:'fixture-key',
    fetch:async(url:any,options:any)=>{ requests.push({url:new URL(url),options}); return {ok:true,text:async()=>'{}'}; },
  };
  vm.createContext(context);
  vm.runInContext(transformSync(code,{loader:'ts',format:'cjs'}).code,context);
  for(const route of ['/recover','/otp']){
    await context.callSupabaseAuth(route,{email:'fixture@example.test',redirect_to:'https://oceancore-frontend.vercel.app/'});
    const request=requests.at(-1);
    assert.equal(request.url.searchParams.get('redirect_to'),'https://oceancore-frontend.vercel.app/');
    assert.deepEqual(JSON.parse(request.options.body),{email:'fixture@example.test'});
  }
  await context.callSupabaseAuth('/token?grant_type=password',{email:'fixture@example.test',password:'test-only'});
  assert.equal(requests.at(-1).url.searchParams.get('grant_type'),'password');
  assert.equal(JSON.parse(requests.at(-1).options.body).password,'test-only');
});
