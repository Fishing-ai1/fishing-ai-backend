// Registry metadata does not grant redistribution rights. Connection status is persisted separately.
import { AU_SOURCES } from './au-sources.ts';
export const PROVIDERS = [
  { id: 'au-aho', name: 'Australian Hydrographic Office', country: 'AU', source_url: 'https://www.hydro.gov.au/charts/ausenc', adapter: 'licensed_chart', attribution: 'Australian Hydrographic Office; licence required for redistribution.' },
  { id: 'au-amsa', name: 'Australian Maritime Safety Authority', country: 'AU', source_url: 'https://www.amsa.gov.au/', adapter: 'reviewed_document', attribution: 'AMSA; check each source licence.' },
  { id: 'au-bom', name: 'Bureau of Meteorology', country: 'AU', source_url: 'https://www.bom.gov.au/marine/', adapter: 'licensed_forecast', attribution: 'Bureau of Meteorology; terms and feed access must be approved.' },
  { id: 'us-noaa-charts', name: 'NOAA Office of Coast Survey', country: 'US', source_url: 'https://www.nauticalcharts.noaa.gov/data/gis-data-and-services.html', adapter: 'noaa_chart', attribution: 'NOAA Office of Coast Survey; verify layer licence and notices.' },
  { id: 'us-noaa-fisheries', name: 'NOAA Fisheries', country: 'US', source_url: 'https://www.fisheries.noaa.gov/', adapter: 'reviewed_document', attribution: 'NOAA Fisheries; management area and effective dates required.' },
  { id: 'us-nws', name: 'National Weather Service', country: 'US', source_url: 'https://www.weather.gov/documentation/services-web-api', adapter: 'nws', attribution: 'National Weather Service; forecasts are not navigation charts.' },
  { id: 'us-uscg', name: 'US Coast Guard', country: 'US', source_url: 'https://www.uscg.mil/', adapter: 'reviewed_document', attribution: 'US Coast Guard; verify applicable district and notice dates.' },
  ...AU_SOURCES,
];
export interface ChartProvider { id: string; capabilities: string[]; status: 'not_connected' | 'connected'; layers(context: { country: string; bounds: number[] }): Promise<{ id: string; attribution: string; url: string }[]>; }
export class UnconnectedChartProvider implements ChartProvider {
  status = 'not_connected' as const;
  constructor(public id: string, public capabilities: string[]) {}
  async layers() { throw Object.assign(new Error('Chart provider NOT CONNECTED: approved licence and endpoint required.'), { statusCode: 503 }); }
}
export function safeSourceUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) return null; return url.href; } catch { return null; }
}
