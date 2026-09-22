import {createHash} from 'node:crypto';
import {httpError} from './permissions.ts';
import {locationContext} from './localisation.ts';

export const KNOWLEDGE_KINDS=['species','boat','outboard','tackle','technique','marine','regulation'] as const;
export function prepareKnowledgeImport(source:any,body:any,now=Date.now()){
 if(!source || source.status==='disabled')throw httpError('Source is unavailable.');
 if(!source.licence_approved)throw httpError('Source reuse must be approved before importing content.',409);
 const rows=body.items;
 if(!Array.isArray(rows)||!rows.length||rows.length>25)throw httpError('Import between 1 and 25 knowledge items.');
 if(JSON.stringify(rows).length>150000)throw httpError('Import is too large.',413);
 return rows.map((row:any)=>{
  if(!KNOWLEDGE_KINDS.includes(row.kind)||typeof row.title!=='string'||!row.title.trim()||row.title.length>200||typeof row.body!=='string'||row.body.length<10||row.body.length>30000)throw httpError('Each item needs a supported kind, title and bounded text.');
  let url:URL;try{url=new URL(row.source_url);}catch{throw httpError('A source URL is required.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(source.allowed_hosts||[]).includes(url.hostname))throw httpError('The URL does not belong to an approved source host.');
  const location=locationContext(row);
  if(source.country && location.country!==source.country)throw httpError('Source and record countries must match.');
  if(source.subdivision && location.subdivision!==source.subdivision)throw httpError('Source and record jurisdictions must match.');
  const checked=Date.parse(row.checked_at);
  if(!Number.isFinite(checked)||checked>now||now-checked>7*86400000)throw httpError('Provide a source check from the last seven days.');
  if(row.kind==='regulation' && (!location.country||!location.waters||((location.waters==='state'||location.waters==='inland')&&!location.subdivision)||!Number.isFinite(Date.parse(row.effective_from))))throw httpError('Regulations require country, waters, applicable state and a documented effective date.');
  for(const key of ['effective_from','effective_until','source_updated_at'])if(row[key]!=null&&!Number.isFinite(Date.parse(row[key])))throw httpError('Invalid source date: '+key);
  if(row.effective_until && (!row.effective_from||Date.parse(row.effective_until)<=Date.parse(row.effective_from)))throw httpError('Effective dates are reversed or incomplete.');
  if(row.canonical_id&&!/^[0-9a-f-]{36}$/i.test(row.canonical_id))throw httpError('Invalid catalog identifier.');
  const content={...location,kind:row.kind,title:row.title.trim(),body:row.body.trim(),source_url:url.href,checked_at:new Date(checked).toISOString(),effective_from:row.effective_from||null,effective_until:row.effective_until||null,version_label:String(row.version_label||'').slice(0,100),review_due_at:new Date(checked+(source.review_interval_hours||168)*3600000).toISOString()};
  if(Date.parse(content.review_due_at)<=now)throw httpError('Source check has already expired. Recheck the original source.');
  return {...content,canonical_id:row.canonical_id||null,source_updated_at:row.source_updated_at||null,content_hash:createHash('sha256').update(JSON.stringify({...content,canonical_id:row.canonical_id||null,checked_at:undefined,review_due_at:undefined})).digest('hex')};
 });
}

export function validateCatalogAttributes(record:any){
 const attrs=record.attributes || {};
 if(typeof attrs!=='object'||Array.isArray(attrs))throw httpError('Attributes must be an object.');
 const numeric:Record<string,string[]>={species:['maximum_length_cm','maximum_weight_kg','depth_min_m','depth_max_m','temperature_min_c','temperature_max_c'],boat:['length_m','beam_m','deadrise_degrees','dry_weight_kg','fuel_capacity_l','maximum_hp','passenger_capacity'],outboard:['year_from','year_to','horsepower','cylinders','displacement_cc','weight_kg','gear_ratio','rpm_min','rpm_max'],tackle:['length_cm','weight_g','line_class_kg','drag_kg']};
 for(const key of numeric[record.kind]||[])if(attrs[key]!=null && (typeof attrs[key]!=='number'||!Number.isFinite(attrs[key])||(!key.startsWith('temperature_')&&attrs[key]<0)))throw httpError('Invalid canonical measurement: '+key);
 for(const [low,high] of [['depth_min_m','depth_max_m'],['temperature_min_c','temperature_max_c'],['year_from','year_to'],['rpm_min','rpm_max']])if(attrs[low]!=null&&attrs[high]!=null&&attrs[low]>attrs[high])throw httpError('Measurement range is reversed.');
 if(Object.keys(attrs).length && record.status==='approved' && (!record.source_id||!record.source_url))throw httpError('Approved specifications require source attribution.');
 return attrs;
}
