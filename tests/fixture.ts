import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
export const OWNER='11111111-1111-4111-8111-111111111111',MEMBER='22222222-2222-4222-8222-222222222222',MODERATOR='44444444-4444-4444-8444-444444444444';
export async function fixture() {
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,email text,full_name text,username text,boat_name text,home_port text,favourite_species text,avatar_url text,account_status text default 'active',plan text default 'free',subscription_status text default 'none',created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.catches(id uuid primary key,user_id uuid,lat double precision,lng double precision,created_at timestamptz default now());
 create table public.community_posts(id uuid primary key,user_id uuid,status text,privacy text,visibility text);
 create table public.community_comments(id uuid primary key,post_id uuid,user_id uuid,status text);
 create table public.usage_daily(user_id uuid,ai_requests integer);create table public.audit_log(id uuid);`);
 for(const file of ['20260908094246_oceancore_global_control_foundation.sql','20260908200645_oceancore_legacy_privacy_hardening.sql','20260909073408_oceancore_location_coverage.sql','20260909075911_oceancore_ai_attempt_tracking.sql','20260909080455_oceancore_reviewed_knowledge_ingestion.sql','20260922071147_oceancore_monetization_financial_control.sql'])await pg.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 for(const [id,name] of [[OWNER,'Test Owner'],[MEMBER,'Test Member'],[MODERATOR,'Test Moderator']]){await pg.query('insert into auth.users values($1)',[id]);await pg.query('insert into public.profiles(id,email,full_name,username) values($1,$2,$3,$4)',[id,name.replaceAll(' ','').toLowerCase()+'@example.test',name,name.replaceAll(' ','').toLowerCase()]);}
 await pg.query("insert into public.oc_admin_roles(user_id,role) values($1,'moderator')",[MODERATOR]);
 return pg;
}
const ident=(s:string)=>{if(!/^[a-z_][a-z_0-9]*$/i.test(s))throw Error('Invalid fixture SQL identifier');return '"'+s+'"';};
// Test-only PostgREST-compatible adapter. All real SQL goes to an isolated in-memory Postgres.
export function adapter(pg:PGlite):any {
 class Query {
  cols='*';conditions:{sql:string;values:any[]}[]=[];orders:string[]=[];limitValue:number|undefined;offset=0;one=false;count=false;op='select';rows:any;conflict='';
  constructor(public table:string){}
  select(cols='*',options:any={}){this.cols=cols;this.count=!!options.count;return this;}
  eq(key:string,value:any){this.conditions.push({sql:ident(key)+' = ?',values:[value]});return this;}
  in(key:string,values:any[]){this.conditions.push({sql:ident(key)+' in ('+values.map(()=>'?').join(',')+')',values});return this;}
  ilike(key:string,value:string){this.conditions.push({sql:ident(key)+' ilike ?',values:[value]});return this;}
  or(expression:string){const terms=expression.split(',').map(term=>{const [key,op,...rest]=term.split('.');if(op!=='ilike')throw Error('Unsupported fixture operator');return {key,value:rest.join('.')};});this.conditions.push({sql:'('+terms.map(t=>ident(t.key)+' ilike ?').join(' or ')+')',values:terms.map(t=>t.value)});return this;}
  order(key:string,options:any={}){this.orders.push(ident(key)+(options.ascending===false?' desc':' asc'));return this;}
  range(from:number,to:number){this.offset=from;this.limitValue=to-from+1;return this;}
  limit(n:number){this.limitValue=n;return this;}
  maybeSingle(){this.one=true;return this;}
  single(){this.one=true;return this;}
  insert(rows:any){this.op='insert';this.rows=rows;return this;}
  upsert(rows:any){this.op='upsert';this.rows=rows;return this;}
  update(row:any){this.op='update';this.rows=row;return this;}
  async execute(){try{
   const table='public.'+ident(this.table),cols=this.cols==='*'?'*':this.cols.split(',').map(ident).join(',');let values:any[]=[],sql='';
   const where=()=>this.conditions.length?' where '+this.conditions.map(c=>{let index=0;return c.sql.replaceAll('?',()=>{values.push(c.values[index++]);return '$'+values.length;});}).join(' and '):'';
   if(this.op==='select')sql='select '+cols+' from '+table+where();
   else if(this.op==='update'){const keys=Object.keys(this.rows);values=keys.map(k=>this.rows[k]);sql='update '+table+' set '+keys.map((k,i)=>ident(k)+'=$'+(i+1)).join(',')+where()+' returning '+cols;}
   else{const rows=Array.isArray(this.rows)?this.rows:[this.rows],keys=Object.keys(rows[0]);sql='insert into '+table+'('+keys.map(ident).join(',')+') values '+rows.map(r=>'('+keys.map(k=>{values.push(typeof r[k]==='object'&&r[k]!==null?JSON.stringify(r[k]):r[k]);return '$'+values.length;}).join(',')+')').join(',');if(this.op==='upsert'){const key=keys.includes('user_id')?'user_id':'id';sql+=' on conflict('+ident(key)+') do update set '+keys.map(k=>ident(k)+'=excluded.'+ident(k)).join(',');}sql+=' returning '+cols;}
   let count=null;if(this.count){const countSql=sql.replace('select '+cols,'select count(*) as count');count=Number((await pg.query(countSql,values)).rows[0].count);}
   if(this.op==='select'){if(this.orders.length)sql+=' order by '+this.orders.join(',');if(this.limitValue!==undefined)sql+=' limit '+this.limitValue+' offset '+this.offset;}
   const r=await pg.query(sql,values);return {data:this.one?r.rows[0]||null:r.rows,error:null,count};
  }catch(error:any){return {data:null,error:{code:error.code,message:error.message},count:null};}}
  then(resolve:any,reject:any){return this.execute().then(resolve,reject);}
 }
 return {from:(t:string)=>new Query(t),rpc:async(name:string,args:any)=>{try{const keys=Object.keys(args);const r=await pg.query('select * from public.'+ident(name)+'('+keys.map((k,i)=>ident(k)+'=> $'+(i+1)).join(',')+')',keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return {data:r.fields.length===1&&r.fields[0].name===name?r.rows[0][name]:r.rows,error:null};}catch(e:any){return {data:null,error:{code:e.code,message:e.message}};}},auth:{admin:{getUserById:async(id:string)=>({data:{user:{id,email:'test@example.test'}}}),updateUserById:async()=>({error:null})}}};
}
