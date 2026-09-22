export type Units = 'metric' | 'us_customary';
export type LocationContext = { country: string | null; subdivision: string | null; region: string | null; locality: string | null; latitude: number | null; longitude: number | null; timezone: string | null; marine_region: string | null; units: Units; waters: 'state' | 'federal' | 'inland' | null };
export const AU_SUBDIVISIONS = 'ACT:Australian Capital Territory|NSW:New South Wales|NT:Northern Territory|QLD:Queensland|SA:South Australia|TAS:Tasmania|VIC:Victoria|WA:Western Australia|JBT:Jervis Bay Territory|CX:Christmas Island|CC:Cocos (Keeling) Islands|NF:Norfolk Island|HM:Heard Island and McDonald Islands|AAT:Australian Antarctic Territory|CSI:Coral Sea Islands|ACI:Ashmore and Cartier Islands';
export const US_SUBDIVISIONS = 'AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|DC:District of Columbia|AS:American Samoa|GU:Guam|MP:Northern Mariana Islands|PR:Puerto Rico|VI:US Virgin Islands|UM:US Minor Outlying Islands';
export const subdivisions = (country: string) => (country === 'AU' ? AU_SUBDIVISIONS : country === 'US' ? US_SUBDIVISIONS : '').split('|').filter(Boolean).map(v => { const [code, name] = v.split(':'); return { code, name }; });
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : null;
export function locationContext(input: any = {}): LocationContext {
  const country = text(input.country)?.toUpperCase() || null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw Object.assign(new Error('Use a two-letter country code.'), { statusCode: 400 });
  const subdivision = text(input.subdivision)?.toUpperCase() || null;
  if (subdivision && (!country || (['AU', 'US'].includes(country) && !subdivisions(country).some(s => s.code === subdivision)))) throw Object.assign(new Error('Subdivision does not belong to the selected country.'), { statusCode: 400 });
  const coord = (v: any, max: number) => { if (v == null || v === '') return null; if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > max) throw Object.assign(new Error('Invalid coordinates.'), { statusCode: 400 }); return v; };
  const latitude = coord(input.latitude, 90), longitude = coord(input.longitude, 180);
  if ((latitude == null) !== (longitude == null)) throw Object.assign(new Error('Both coordinates are required.'), { statusCode: 400 });
  const timezone = text(input.timezone);
  if (timezone) { try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw Object.assign(new Error('Invalid timezone.'), { statusCode: 400 }); } }
  if (input.units != null && !['metric', 'us_customary'].includes(input.units)) throw Object.assign(new Error('Invalid measurement system.'), { statusCode: 400 });
  if (input.waters != null && !['state', 'federal', 'inland'].includes(input.waters)) throw Object.assign(new Error('Invalid waters jurisdiction.'), { statusCode: 400 });
  return { country, subdivision, region: text(input.region), locality: text(input.locality), latitude, longitude, timezone, marine_region: text(input.marine_region), units: input.units || (country === 'US' ? 'us_customary' : 'metric'), waters: input.waters || null };
}
const conversions = { temperature: { scale: 9 / 5, offset: 32, metric: '°C', us: '°F' }, distance: { scale: 1 / 1.609344, offset: 0, metric: 'km', us: 'mi' }, depth: { scale: 1 / 0.3048, offset: 0, metric: 'm', us: 'ft' }, weight: { scale: 1 / 0.45359237, offset: 0, metric: 'kg', us: 'lb' }, length: { scale: 1 / 2.54, offset: 0, metric: 'cm', us: 'in' }, fuel: { scale: 1 / 3.785411784, offset: 0, metric: 'L', us: 'US gal' } };
export function convert(value: number, quantity: keyof typeof conversions, units: Units, direction: 'display' | 'canonical' = 'display') {
  if (!Number.isFinite(value) || !conversions[quantity]) throw new Error('Invalid measurement.');
  const c = conversions[quantity];
  return units === 'metric' ? value : direction === 'display' ? value * c.scale + c.offset : (value - c.offset) / c.scale;
}
export function displayMeasurement(value: number, quantity: keyof typeof conversions, units: Units) { return { value: convert(value, quantity, units), unit: units === 'metric' ? conversions[quantity].metric : conversions[quantity].us }; }
// Marine distances are an explicit choice, independent of the land-unit system.
export function marineDistance(kilometres: number, unit: 'km' | 'mi' | 'nm') {
  if (!Number.isFinite(kilometres) || !['km','mi','nm'].includes(unit)) throw new Error('Invalid distance.');
  return { value: kilometres / (unit === 'nm' ? 1.852 : unit === 'mi' ? 1.609344 : 1), unit };
}
export const LOCATION_FIELDS = ['country','subdivision','region','locality','latitude','longitude','timezone','marine_region','units','waters'] as const;
// PATCH must distinguish an omitted value from an explicit privacy-preserving null.
export function mergeLocation(previous: any, patch: any) {
  const next = { ...previous, ...Object.fromEntries(LOCATION_FIELDS.filter(k=>Object.hasOwn(patch,k)).map(k=>[k,patch[k]])) };
  if (Object.hasOwn(patch,'country') && patch.country !== previous.country) {
    for (const key of ['subdivision','region','locality','marine_region','waters','timezone']) if (!Object.hasOwn(patch,key)) next[key]=null;
  }
  return locationContext(next);
}
// No reverse-geocoding assumption: country, state and waters are separate from GPS.
export function safeLocation(row: any, viewerId: string | null, approved = false) {
  if (row.user_id === viewerId || row.privacy === 'public' || (row.privacy === 'friends' && approved)) return row;
  const { lat, lng, latitude, longitude, notes, photo_url, ...safe } = row;
  return { ...safe, lat: null, lng: null, latitude: null, longitude: null };
}
