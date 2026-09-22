import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('existing frontend scripts parse and display canonical catch and marine values in the selected units',()=>{
 const html=fs.readFileSync('../fishing-ai-frontend/index.html','utf8');
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if(!match[1].includes('application/ld+json') && match[2].trim()) new vm.Script(match[2]);
 let units='imperial';const context=vm.createContext({currentCatchUnits:()=>units});
 for(const name of ['convertCatchMeasureForApi','formatDistance','formatMarineMetric','formatCatchMeasures','cardLength','cardWeight']) {
  const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);
  vm.runInContext(html.slice(start,end),context);
 }
 assert.equal(vm.runInContext('formatDistance(1.609344)',context),'1.00 mi');
 assert.equal(vm.runInContext("formatMarineMetric(0.3048,'m')",context),'1.0 ft');
 assert.equal(vm.runInContext("formatMarineMetric(0,'°C')",context),'32 °F');
 assert.equal(vm.runInContext('formatCatchMeasures({length_cm:2.54,weight_kg:0.45359237})',context),'1.0 in · 1.00 lb');
 assert.equal(vm.runInContext("convertCatchMeasureForApi('', 'weight')",context),'');
 assert.equal(vm.runInContext("convertCatchMeasureForApi('10', 'weight')",context),'4.54');
 assert.equal(vm.runInContext('cardLength(2.54)',context),'1 IN');assert.equal(vm.runInContext('cardWeight(0.45359237)',context),'1 LB');
 vm.runInContext("state={regionalPreferences:{marine_distance_unit:'nm'}}",context);
 assert.equal(vm.runInContext('formatDistance(1.852)',context),'1.00 nm');
 vm.runInContext('state.regionalPreferences={}',context);
 units='metric';assert.equal(vm.runInContext('formatDistance(1)',context),'1.00 km');
 assert.equal(vm.runInContext("formatMarineMetric(0,'°C')",context),'0 °C');
});
