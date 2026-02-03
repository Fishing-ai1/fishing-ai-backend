// ===========================================
// Weather Context for AI Brain
// (Stub – replace with real API later)
// ===========================================
export async function getWeatherContext(lat: number, lng: number) {
  try {
    return {
      wind_kts: 10 + Math.floor(Math.random() * 15),
      sst_c: 20 + Math.random() * 5,
      pressure_hpa: 1008 + Math.random() * 8,
      moon_phase: "Waxing",
      tide_state: "Incoming"
    };
  } catch (e) {
    return null;
  }
}
