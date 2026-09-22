import { randomUUID } from 'node:crypto';
import { prepareKnowledgeImport, validateCatalogAttributes } from './knowledge-import.ts';
import { signCatchMedia } from './catch-media.ts';
import { validatedLocation } from './location-store.ts';
import { locationContext, mergeLocation, subdivisions } from './localisation.ts';
import { PERMISSIONS, permits, httpError, pageInput, requireReason, requireConfirmation } from './permissions.ts';
import { safeSourceUrl } from './providers.ts';
import { retrieveKnowledge } from './knowledge.ts';
import { calculateFinancialHealth, SIMULATOR_PRESETS, simulateEconomics } from '../monetization/financial.ts';
const uuid = (v: any) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v))) throw httpError('Invalid identifier.'); return String(v); };
const recordKinds = ['species','manufacturer','boat','outboard','tackle','technique','region','fishing_zone','ramp','marina','fuel','fad','reef','closure','business','charter','product','announcement','marketplace'];
export function registerPlatform(app: any, deps: { db: any; enabled: boolean; auth: (req: any) => Promise<any>; owner: (user: any) => boolean; gateway: any }) {
  const { db, enabled, auth, owner, gateway } = deps;
  const connected = () => { if (!enabled || !db) throw httpError('Control Centre NOT CONNECTED. Apply and verify the platform migration before activation.', 503); };
  const checked = async (query: any) => { const result = await query; if (result.error) { console.error(JSON.stringify({ event: 'platform_database_error', code: result.error.code || 'unknown' })); throw httpError('The operation could not be saved or loaded.', 503); } return result; };
  const roleFor = async (user: any) => { if (owner(user)) return 'owner'; const r = await checked(db.from('oc_admin_roles').select('role').eq('user_id', user.id).maybeSingle()); return r.data?.role || null; };
  const admin = async (req: any, permission: string) => { connected(); const user = await auth(req); const role = await roleFor(user); if (!permits(role, permission)) throw httpError('You do not have permission for this operation.', 403); return { user, role }; };
  const route = (method: string, path: string, handler: any) => app.route({ method, url: path, handler: async (req: any, reply: any) => { reply.header('Cache-Control','no-store'); try { return await handler(req, reply); } catch (e: any) { return reply.code(e.statusCode || 500).send({ success: false, error: e.statusCode ? e.message : 'Operation failed.' }); } } });
  const mutate = async (actor: any, action: string, target: string, payload: any, reason: string) => (await checked(db.rpc('oc_admin_mutate', { p_actor: actor.id, p_action: action, p_target: target, p_payload: payload, p_reason: reason }))).data;
  route('POST','/admin/control/knowledge/import',async(req:any)=>{
    const {user}=await admin(req,'data.write');const reason=requireReason(req.body);
    const source=(await checked(db.from('oc_sources').select('*').eq('id',String(req.body.source_id||'')).maybeSingle())).data;
    const items=prepareKnowledgeImport(source,req.body);
    return {result:(await checked(db.rpc('oc_import_knowledge',{p_actor:user.id,p_source:source.id,p_items:items,p_reason:reason}))).data};
  });
  route('PATCH','/admin/control/sources/:id/policy',async(req:any)=>{
    const {user}=await admin(req,'settings.write');const b=req.body||{},reason=requireReason(b);
    if(typeof b.licence_approved!=='boolean'||!Number.isInteger(b.review_interval_hours)||b.review_interval_hours<1||b.review_interval_hours>8760|| (b.licence_approved&&!safeSourceUrl(b.licence_url)))throw httpError('Provide a reuse decision, HTTPS licence reference and review interval.');
    return {source:(await checked(db.rpc('oc_source_policy',{p_actor:user.id,p_id:req.params.id,p_approved:b.licence_approved,p_licence_url:b.licence_url||null,p_interval:b.review_interval_hours,p_reason:reason}))).data};
  });
  route('GET','/api/platform/authorities',async(req:any)=>{
    connected();await auth(req);const context=locationContext({country:req.query.country,subdivision:req.query.subdivision});
    if(!context.country)throw httpError('Choose a country.');
    const rows=(await checked(db.from('oc_sources').select('id,name,country,subdivision,source_url,status,attribution,review_interval_hours').eq('country',context.country).order('name').limit(100))).data||[];
    return {sources:rows.filter((r:any)=>!context.subdivision||!r.subdivision||r.subdivision===context.subdivision),note:'Official source directory; connection status does not establish current fishing rules.'};
  });
  route('POST','/admin/control/catches/:id/photo',async (req: any) => {
    const {user}=await admin(req,'private.read'); const id=uuid(req.params.id); const reason=requireReason(req.body);
    const row=(await checked(db.from('catches').select('id,user_id,photo_url').eq('id',id).maybeSingle())).data;
    if(!row || !row.photo_url?.startsWith('oc-catch:')) throw httpError('Private photo not found. Legacy media requires migration.',404);
    // A durable access intent is required before issuing a bearer viewing link.
    await checked(db.from('oc_audit').insert({actor_id:user.id,action:'private.photo.view',target_type:'catch',target_id:id,reason}));
    return {photo_url:await signCatchMedia(db,row.photo_url,row.user_id),expires_in:300};
  });
  route('GET','/api/platform/status',async () => ({ success: true, connected: enabled && !!db, activation: enabled ? 'enabled' : 'not_connected' }));
  route('GET','/api/platform/public-config',async () => { connected(); const r=await checked(db.from('oc_settings').select('key,value').eq('key','maintenance.notice')); return {notice:r.data?.[0]?.value || ''}; });
  route('GET','/api/platform/countries',async () => { connected(); return { countries: (await checked(db.from('oc_countries').select('*').eq('active',true).order('name'))).data }; });
  route('GET','/api/platform/subdivisions/:country',async (req: any) => { connected(); return { subdivisions: (await checked(db.from('oc_subdivisions').select('code,name').eq('country',String(req.params.country).toUpperCase()).eq('active',true).order('name'))).data }; });
  route('GET','/api/platform/preferences',async (req: any) => { connected(); const user=await auth(req); return { preferences: (await checked(db.from('oc_user_preferences').select('*').eq('user_id',user.id).maybeSingle())).data || { ...locationContext(), ai_personal_context: false, share_for_patterns: false } }; });
  route('PATCH','/api/platform/preferences',async (req: any) => {
    connected(); const user=await auth(req); const old=(await checked(db.from('oc_user_preferences').select('*').eq('user_id',user.id).maybeSingle())).data || {};
    const body=req.body || {}; const value=await validatedLocation(db,mergeLocation(old,body));
    const distanceUnit=body.marine_distance_unit===undefined?old.marine_distance_unit:body.marine_distance_unit;
    if(distanceUnit!=null&&!['km','mi','nm'].includes(distanceUnit))throw httpError('Invalid marine distance unit.');
    if (value.country) { const c=await checked(db.from('oc_countries').select('code').eq('code',value.country).eq('active',true).maybeSingle()); if (!c.data) throw httpError('Country is not active.'); }
    const row={ ...value,user_id:user.id,ai_personal_context:body.ai_personal_context === undefined ? !!old.ai_personal_context : body.ai_personal_context === true,share_for_patterns:body.share_for_patterns === undefined ? !!old.share_for_patterns : body.share_for_patterns === true,updated_at:new Date().toISOString() };
    return { preferences:(await checked(db.from('oc_user_preferences').upsert({...row,marine_distance_unit:distanceUnit || null}).select('*').single())).data };
  });
  route('GET','/api/platform/search',async (req: any) => {
    connected(); await auth(req); const q=String(req.query.q || '').trim().slice(0,100); if(q.length<2) throw httpError('Enter at least two characters.');
    const p=pageInput(req.query); let query=db.from('oc_records').select('id,kind,name,aliases,country,subdivision,source_url',{count:'exact'}).eq('status','approved').ilike('name',`%${q.replace(/[%_\\]/g,'')}%`);
    if(req.query.kind) query=query.eq('kind',req.query.kind);
    const r=await checked(query.order('name').order('id').range(p.from,p.to)); return { results:r.data,total:r.count,page:p.page };
  });
  route('POST','/api/platform/knowledge/search',async (req: any) => { connected(); const user=await auth(req); const pref=(await checked(db.from('oc_user_preferences').select('*').eq('user_id',user.id).maybeSingle())).data; return { sources:await retrieveKnowledge(db,String(req.body?.q || ''),locationContext(pref || {})) }; });
  route('POST','/api/platform/appeals',async (req: any) => { connected(); const user=await auth(req), body=req.body || {}; const flag=(await checked(db.from('oc_moderation').select('id').eq('id',uuid(body.moderation_id)).eq('user_id',user.id).maybeSingle())).data; if(!flag) throw httpError('Moderation event not found.',404); return { appeal:(await checked(db.from('oc_appeals').insert({user_id:user.id,moderation_id:flag.id,reason:requireReason(body)}).select('id,status').single())).data }; });
  route('GET','/admin/control/me',async (req: any) => { connected(); const user=await auth(req),role=await roleFor(user); if(!role) throw httpError('Admin access denied.',403); return { role,permissions:PERMISSIONS[role as keyof typeof PERMISSIONS],user_id:user.id }; });
  route('GET','/admin/control/users',async (req: any) => {
    await admin(req,'users.read'); const p=pageInput(req.query); const q=String(req.query.q || '').trim().slice(0,100).replace(/[^\p{L}\p{N}@. +_-]/gu,'');
    let query=db.from('profiles').select('id,email,full_name,username,account_status,plan,created_at,updated_at',{count:'exact'});
    if(q) query=/^[0-9a-f-]{36}$/i.test(q) ? query.eq('id',q) : query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%,username.ilike.%${q}%`);
    if(req.query.status) query=query.eq('account_status',req.query.status);
    const r=await checked(query.order('created_at',{ascending:false}).order('id').range(p.from,p.to)); return { users:r.data,total:r.count,page:p.page,limit:p.limit };
  });
  route('GET','/admin/control/users/:id',async (req: any) => {
    await admin(req,'users.read'); const id=uuid(req.params.id);
    const profile=(await checked(db.from('profiles').select('id,email,full_name,username,boat_name,home_port,favourite_species,account_status,plan,subscription_status,created_at,updated_at').eq('id',id).maybeSingle())).data;
    if(!profile) throw httpError('User not found.',404);
    const prefs=(await checked(db.from('oc_user_preferences').select('country,subdivision,region,units,timezone').eq('user_id',id).maybeSingle())).data;
    return { profile,location:prefs };
  });
  route('GET','/admin/control/users/:id/timeline',async (req: any) => { await admin(req,'users.read'); const p=pageInput(req.query); return { events:(await checked(db.rpc('oc_user_timeline',{p_user:uuid(req.params.id),p_event:String(req.query.event || ''),p_limit:p.limit,p_offset:p.from}))).data,page:p.page }; });
  route('POST','/admin/control/users/:id/notes',async (req: any) => { const {user}=await admin(req,'users.read'); const reason=requireReason(req.body); return { result:await mutate(user,'user.note',uuid(req.params.id),{note:String(req.body.note || '').slice(0,2000)},reason) }; });
  route('PATCH','/admin/control/users/:id/role',async (req: any) => { const {user}=await admin(req,'roles.write'); const id=uuid(req.params.id); requireConfirmation(req.body,id); if (!['none',...Object.keys(PERMISSIONS)].includes(req.body.role)) throw httpError('Invalid role.'); return { result:await mutate(user,'role.set',id,{role:req.body.role},requireReason(req.body)) }; });
  route('PATCH','/admin/control/users/:id/status',async (req: any) => {
    const {user}=await admin(req,'users.write'); const id=uuid(req.params.id); requireConfirmation(req.body,id); if(id===user.id) throw httpError('Cannot restrict your own account.');
    if(!['active','restricted','suspended','banned','deactivated'].includes(req.body.status)) throw httpError('Invalid account status.');
    const targetRole=await checked(db.from('oc_admin_roles').select('role').eq('user_id',id).maybeSingle());
    const target=await db.auth.admin.getUserById(id); if(target.error) throw httpError('User could not be verified.',503);
    if(owner(target.data.user) || targetRole.data?.role==='owner') throw httpError('Owner accounts cannot be restricted here.',403);
    const result=await mutate(user,'user.status',id,{status:req.body.status},requireReason(req.body));
    const authResult=await db.auth.admin.updateUserById(id,{ban_duration:['suspended','banned','deactivated'].includes(req.body.status)?'876000h':'none'});
    if(authResult.error) return { success:false,result,error:'Account policy saved; authentication sync failed. Review this user before retrying.' };
    return { result };
  });
  const sections:Record<string,{table:string;permission:string;order:string}>={ records:{table:'oc_records',permission:'data.read',order:'updated_at'},knowledge:{table:'oc_knowledge',permission:'data.read',order:'updated_at'},sources:{table:'oc_sources',permission:'data.read',order:'id'},moderation:{table:'oc_moderation',permission:'moderation.read',order:'created_at'},appeals:{table:'oc_appeals',permission:'moderation.read',order:'created_at'},audit:{table:'oc_audit',permission:'audit.read',order:'created_at'},ai:{table:'oc_ai_requests',permission:'ai.read',order:'created_at'},jobs:{table:'oc_jobs',permission:'data.read',order:'created_at'},settings:{table:'oc_settings',permission:'settings.write',order:'key'} };
  route('GET','/admin/control/list/:section',async (req: any) => {
    const s=sections[req.params.section]; if(!s) throw httpError('Unknown section.',404); await admin(req,s.permission); const p=pageInput(req.query);
    let query=db.from(s.table).select('*',{count:'exact'});
    // Knowledge private-user records are deliberately excluded from general admin data views.
    if(s.table==='oc_knowledge') query=query.eq('visibility','public');
    if(req.query.kind && ['records','knowledge'].includes(req.params.section)) query=query.eq('kind',String(req.query.kind));
    if(req.query.status && ['records','knowledge','moderation','appeals','jobs'].includes(req.params.section)) query=query.eq('status',String(req.query.status));
    const r=await checked(query.order(s.order,{ascending:false}).range(p.from,p.to)); return { rows:r.data,total:r.count,page:p.page };
  });
  route('POST','/admin/control/records',async (req: any) => {
    const {user}=await admin(req,'data.write'); const b=req.body || {},r=b.record || {};
    if(!recordKinds.includes(r.kind) || !String(r.name || '').trim() || !/^[a-z0-9][a-z0-9:._-]{1,159}$/.test(r.canonical_key || '')) throw httpError('Kind, name and a stable canonical identifier are required.');
    if(JSON.stringify(r).length>40000) throw httpError('Record is too large.');
    validateCatalogAttributes(r);
    const location=await validatedLocation(db,r); const id=r.id?uuid(r.id):randomUUID();
    if(r.source_url && !safeSourceUrl(r.source_url)) throw httpError('Use a public HTTPS source URL.');
    if(r.status==='merged') { uuid(r.merged_into); requireConfirmation(b,id); }
    return { record:await mutate(user,'record.save',id,{...r,...location,source_url:r.source_url || null},requireReason(b)) };
  });
  route('POST','/admin/control/knowledge',async (req: any) => {
    const {user}=await admin(req,'data.write'); const b=req.body || {},k=b.record || {}; const location=await validatedLocation(db,k);
    if(!k.title || !k.body || String(k.body).length>30000 || !['official','verified'].includes(k.trust) || !k.kind) throw httpError('Title, body, kind and trust level are required.');
    if(k.status==='approved' && (!safeSourceUrl(k.source_url) || !k.source_id)) throw httpError('Approved knowledge requires a source and HTTPS reference.');
    if(k.status==='approved' && (!Number.isFinite(Date.parse(k.checked_at)) || Date.parse(k.checked_at)>Date.now() || !Number.isFinite(Date.parse(k.review_due_at)) || Date.parse(k.review_due_at)<=Date.now()))throw httpError('Approved knowledge requires a completed source check and a future review deadline.');
    if(k.status==='approved'){
      const source=(await checked(db.from('oc_sources').select('*').eq('id',k.source_id).maybeSingle())).data;
      if(!source || source.status==='disabled' || !(source.allowed_hosts||[]).includes(new URL(k.source_url).hostname) || (source.country&&source.country!==location.country) || (source.subdivision&&source.subdivision!==location.subdivision))throw httpError('Source host and jurisdiction must match the approved record.');
    }
    if(k.kind==='regulation' && k.status==='approved' && (!k.country || !k.waters || !k.effective_from || !k.checked_at || !(Date.parse(k.review_due_at)>Date.now()) || Date.parse(k.checked_at)>Date.now())) throw httpError('Regulations require a jurisdiction, effective date, checked date and future review deadline.');
    return { record:await mutate(user,'knowledge.save',k.id?uuid(k.id):randomUUID(),{...k,...location},requireReason(b)) };
  });
  route('PATCH','/admin/control/moderation/:id',async (req: any) => { const {user}=await admin(req,'moderation.write'); if(!['dismissed','escalated','resolved'].includes(req.body?.status)) throw httpError('Invalid resolution.'); return { result:await mutate(user,'moderation.resolve',uuid(req.params.id),req.body,requireReason(req.body)) }; });
  route('PATCH','/admin/control/appeals/:id',async (req: any) => { const {user}=await admin(req,'moderation.write'); if(!['accepted','rejected'].includes(req.body?.status)) throw httpError('Invalid appeal decision.'); return { result:await mutate(user,'appeal.resolve',uuid(req.params.id),req.body,requireReason(req.body)) }; });
  route('PATCH','/admin/control/settings/:key',async (req: any) => {
    const key=req.params.key; const {user}=await admin(req,key.startsWith('ai.')?'ai.write':'settings.write'); const value=req.body?.value;
    if(['ai.enabled','marketplace.enabled'].includes(key) && typeof value!=='boolean') throw httpError('Use true or false.');
    if(key==='maintenance.notice' && (typeof value!=='string' || value.length>1000)) throw httpError('Notice must be under 1000 characters.');
    if(key==='ai.strategy') { const allowed=new Set([gateway.config.primary,gateway.config.fast,gateway.config.vision,...gateway.config.fallback]); if(!value || Object.keys(value).some(k=>!['primary','fast','vision'].includes(k)) || Object.values(value).some(m=>!allowed.has(m))) throw httpError('Choose only server-approved models.'); }
    return { result:await mutate(user,'setting.set',key,{value},requireReason(req.body)) };
  });
  route('GET','/admin/control/ai/config',async (req: any) => { await admin(req,'ai.read'); return { config:gateway.config } });
  route('GET','/admin/control/dashboard',async (req: any) => { await admin(req,'analytics.read'); const days=Number(req.query.days || 30); if(![7,30,90,365].includes(days)) throw httpError('Select 7, 30, 90 or 365 days.'); return { metrics:(await checked(db.rpc('oc_dashboard',{p_days:days}))).data }; });
  route('GET','/admin/control/financial/weekly',async (req: any) => {
    await admin(req,'finance.read');
    const weekStart=String(req.query.week_start || '').trim();
    if(weekStart && !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw httpError('Use a valid week start date.');
    const report=(await checked(db.rpc('oc_weekly_financial_health',{p_week_start:weekStart || null}))).data || {};
    const current=report.current || {},previous=report.previous || {};
    const change=(now:any,before:any)=>Number(before)>0 ? (Number(now || 0)-Number(before))/Number(before)*100 : null;
    const health=calculateFinancialHealth({
      totalRevenue:Number(current.total_revenue_aud || 0),
      directPlatformCost:Number(current.infrastructure_cost_aud || 0),
      creatorPayoutLiability:Number(current.creator_payout_liability_aud || 0),
      revenuePerUserChangePercent:change(current.revenue_per_active_user_aud,previous.revenue_per_active_user_aud),
      costPerUserChangePercent:change(current.cost_per_active_user_aud,previous.cost_per_active_user_aud),
      infrastructureBurnChangePercent:change(current.infrastructure_cost_aud,previous.infrastructure_cost_aud),
    });
    const warnings:string[]=[];
    const actions:string[]=[];
    if(!current.has_revenue_data) warnings.push('No provider-confirmed or estimated revenue entries exist for this week.');
    if(!current.has_cost_data) warnings.push('No infrastructure cost entries exist for this week.');
    if(!current.has_ad_data) warnings.push('No ad delivery events exist for this week.');
    const fillChange=change(current.fill_rate_percent,previous.fill_rate_percent);
    const ecpmChange=change(current.blended_ecpm_aud,previous.blended_ecpm_aud);
    if(fillChange!=null && fillChange<=-10){warnings.push('Ad fill rate fell by at least 10%.');actions.push('Review provider fill and poorly monetized regions.');}
    if(ecpmChange!=null && ecpmChange<=-10){warnings.push('Blended eCPM fell by at least 10%.');actions.push('Review provider, country and placement revenue breakdowns.');}
    if(health.status==='red'||health.status==='critical') actions.push('Pause paid growth changes until revenue and direct cost data are reconciled.');
    return { report:{...report,health,warnings,recommended_actions:[...new Set(actions)]} };
  });
  route('GET','/admin/control/financial/rules',async (req: any) => {
    await admin(req,'finance.read');
    return {rules:(await checked(db.from('oc_ad_rules').select('*').order('priority').order('created_at'))).data || []};
  });
  route('POST','/admin/control/financial/simulate',async (req: any) => {
    await admin(req,'finance.read');
    const preset=String(req.body?.preset || '').toLowerCase();
    const base=preset && SIMULATOR_PRESETS[preset] ? SIMULATOR_PRESETS[preset] : {};
    const input={...base,...(req.body?.input || {})} as any;
    const required=['mau','dailyActivePercent','minutesPerActiveUserDay','videosPerActiveUserDay','videosPerAdOpportunity','fillRatePercent','eCpmAud','creatorPayoutPercent','subscriptionConversionPercent','subscriptionPriceAud','infrastructureCostPerMauAud','aiCostPerMauAud','videoDeliveryCostPerMinuteAud'];
    if(required.some(key=>!Number.isFinite(Number(input[key])))) throw httpError('Complete every simulator assumption with a valid number.');
    return {scenario:simulateEconomics(input),assumptions:input,value_status:'projected'};
  });
}
