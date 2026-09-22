import { locationContext, mergeLocation, LOCATION_FIELDS } from './localisation.ts';
import { httpError } from './permissions.ts';

export async function validatedLocation(db: any, input: any) {
  const location=locationContext(input);
  if(location.country) {
    const country=await db.from('oc_countries').select('code,default_units').eq('code',location.country).eq('active',true).maybeSingle();
    if(country.error) throw httpError('Regional configuration is unavailable.',503);
    if(!country.data) throw httpError('Country is not active.');
    if(input.units == null) location.units=country.data.default_units;
    if(location.subdivision) {
      const state=await db.from('oc_subdivisions').select('code').eq('country',location.country).eq('code',location.subdivision).eq('active',true).maybeSingle();
      if(state.error) throw httpError('Regional configuration is unavailable.',503);
      if(!state.data) throw httpError('Subdivision does not belong to the selected country.');
    }
  }
  return location;
}

// Only explicit event context is persisted. A home region is not a catch or trip location.
export async function eventLocation(db: any, enabled: boolean, body: any) {
  if(body.location == null) return {};
  if(!enabled || !db) throw httpError('Regional record storage is not enabled.',503);
  if(typeof body.location !== 'object' || Array.isArray(body.location)) throw httpError('Invalid location context.');
  const value=await validatedLocation(db,body.location);
  if((body.lat != null && body.lat !== '') || (body.lng != null && body.lng !== '')) {
    const coordinates=locationContext({latitude:body.lat == null || body.lat === ''?null:Number(body.lat),longitude:body.lng == null || body.lng === ''?null:Number(body.lng)});
    if(value.latitude != null && (value.latitude!==coordinates.latitude || value.longitude!==coordinates.longitude)) throw httpError('Location coordinates conflict with the record coordinates.');
    value.latitude=coordinates.latitude;value.longitude=coordinates.longitude;
  }
  return value;
}

export function registerLocationRoutes(app: any, deps: {db:any;enabled:boolean;auth:(req:any)=>Promise<any>}) {
  const tables:Record<string,string>={catch:'catches',saved_area:'saved_areas',trip:'boat_ai_trip_logs'};
  for(const method of ['GET','PATCH']) app.route({method,url:'/api/platform/locations/:kind/:id',handler:async(req:any,reply:any)=>{
    reply.header('Cache-Control','no-store');
    try {
      if(!deps.enabled || !deps.db) throw httpError('Regional record storage is not enabled.',503);
      const user=await deps.auth(req),table=tables[req.params.kind];
      if(!table || !/^[0-9a-f-]{36}$/i.test(req.params.id)) throw httpError('Unknown location record.',404);
      const legacyCoordinates=['catches','saved_areas'].includes(table);
      const fields=['id',...LOCATION_FIELDS,...(legacyCoordinates?['lat','lng']:[])].join(',');
      const found=await deps.db.from(table).select(fields).eq('id',req.params.id).eq('user_id',user.id).maybeSingle();
      if(found.error) throw httpError('Location could not be loaded.',503);
      if(!found.data) throw httpError('Location record not found.',404);
      const previous={...found.data,latitude:legacyCoordinates?found.data.lat:found.data.latitude,longitude:legacyCoordinates?found.data.lng:found.data.longitude};
      if(method==='GET') return {location:Object.fromEntries(LOCATION_FIELDS.map(k=>[k,previous[k]??null]))};
      const value=await validatedLocation(deps.db,mergeLocation(previous,req.body || {}));
      const result=await deps.db.from(table).update({...value,...(legacyCoordinates?{lat:value.latitude,lng:value.longitude}:{})}).eq('id',req.params.id).eq('user_id',user.id).select(['id',...LOCATION_FIELDS].join(',')).maybeSingle();
      if(result.error) throw httpError('Location could not be saved.',503);
      if(!result.data) throw httpError('Location record not found.',404);
      return {location:result.data};
    }catch(error:any){return reply.code(error.statusCode || 500).send({success:false,error:error.statusCode?error.message:'Location request failed.'});}
  }});
}
