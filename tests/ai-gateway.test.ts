import test from 'node:test';
import assert from 'node:assert/strict';
import {AiGateway,aiConfig,retryPolicy} from '../src/platform/ai.ts';
import {fixture,adapter,OWNER} from './fixture.ts';
const request={userId:OWNER,task:'analysis' as const,feature:'test',instructions:'Answer safely.',input:[{role:'user',content:'Synthetic test only'}]};
test('configuration and retry policy reject unsafe fallback and unbounded model lists',()=>{
 for(const status of [400,401,403,413,422])assert.equal(retryPolicy({status}),'stop');
 assert.equal(retryPolicy({status:429,code:'insufficient_quota'}),'stop');
 assert.equal(retryPolicy({status:500,code:'content_filter'}),'stop');
 assert.equal(retryPolicy({status:404}),'fallback');assert.equal(retryPolicy({status:503}),'retry');
 assert.equal(retryPolicy(new Error('Programming error')),'stop');
 assert.throws(()=>aiConfig({OPENAI_FALLBACK_MODELS:'a,b,c,d'}));
 assert.throws(()=>aiConfig({OPENAI_PRIMARY_MODEL:'   '}));
});
test('refusals, incomplete output and invalid JSON never trigger another model',async()=>{
 for(const response of [{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'Declined'}]}]}, {status:'incomplete',output_text:'Partial',incomplete_details:{reason:'max_output_tokens'}}, {status:'completed',output_text:'invalid JSON'}]){
  let calls=0;const gateway=new AiGateway({responses:{create:async()=>{calls++;return response;}}},null,false,{});
  await assert.rejects(gateway.generate({...request,json:true}));assert.equal(calls,1);
 }
});
test('deadline bounds retry waits and SDK timeout',async()=>{
 let calls=0,timeout=0;const gateway=new AiGateway({responses:{create:async(_args:any,options:any)=>{calls++;timeout=options.timeout;throw {status:503,headers:new Map([['retry-after','5']])};}}},null,false,{OPENAI_TOTAL_TIMEOUT_MS:'10'});
 await assert.rejects(gateway.generate(request));assert.equal(calls,1);assert.ok(timeout<=10);
});
test('trusted task lanes select configured fast and vision models',async()=>{
 const models:string[]=[];const gateway=new AiGateway({responses:{create:async(input:any)=>{models.push(input.model);return {status:'completed',output_text:'OK'};}}},null,false,{OPENAI_PRIMARY_MODEL:'reasoning-model',OPENAI_FAST_MODEL:'fast-model',OPENAI_VISION_MODEL:'vision-model'});
 await gateway.generate({...request,task:'fast'});await gateway.generate({...request,task:'vision'});
 assert.deepEqual(models,['fast-model','vision-model']);
});
test('all attempts are recorded and unknown transport usage is not reported as zero cost',async()=>{
 const pg=await fixture();try{
  let calls=0;const gateway=new AiGateway({responses:{create:async()=>{if(++calls===1)throw {status:503};return {status:'completed',output_text:'OK',usage:{input_tokens:10,output_tokens:2}};}}},adapter(pg),true,{OPENAI_PRIMARY_MODEL:'test-model',OPENAI_FAST_MODEL:'test-model',OPENAI_MODEL_PRICING_JSON:'{"test-model":{"input":1,"output":2}}'});
  const result=await gateway.generate(request);assert.equal(calls,2);assert.equal(result.usage.estimated_cost_usd,null);
  const row=(await pg.query('select * from public.oc_ai_requests where id=$1',[result.request_id])).rows[0] as any;
  assert.equal(row.status,'completed');assert.equal(row.attempts.length,2);assert.equal(row.usage_complete,false);assert.equal(row.estimated_cost_usd,null);assert.ok(Number(row.known_cost_usd)>0);
  assert.ok(!JSON.stringify(row.attempts).includes('Synthetic test'));
 }finally{await pg.close();}
});
test('a thrown telemetry failure does not repeat a successful generation',async()=>{
 let calls=0;const db={rpc:async()=>({data:true}),from:()=>({select:()=>({in:async()=>({data:[]})}),update:()=>{throw Error('Telemetry outage');}})};
 const gateway=new AiGateway({responses:{create:async()=>{calls++;return {status:'completed',output_text:'OK',usage:{input_tokens:1,output_tokens:1}};}}},db,true,{});
 assert.equal((await gateway.generate(request)).answer,'OK');assert.equal(calls,1);
});
