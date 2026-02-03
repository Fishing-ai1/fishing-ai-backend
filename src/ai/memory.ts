// ===========================================
// TEMP STUB: Save AI Memory (no Supabase)
// ===========================================
import { config as dotenv } from "dotenv";
dotenv();

// We are not using Supabase yet in this stub.
// This avoids crashes when SUPABASE_SERVICE_KEY is missing.

export const supabase = null;

export async function saveMemory(memory: any) {
  try {
    console.log("saveMemory stub called. Memory NOT saved to DB.", {
      species: memory?.species,
      lat: memory?.lat,
      lng: memory?.lng
    });
  } catch (e) {
    console.error("Memory stub error:", e);
  }
}
