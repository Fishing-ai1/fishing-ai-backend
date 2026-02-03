// src/ai/learnFromCatch.ts

export type LearnFromCatchInput = {
  user_email?: string | null;
  species: string;
  weight_kg?: number | null;
  length_cm?: number | null;
  lat: number;
  lng: number;
  notes: string;
  created_at: string;
};

/**
 * Stub learning function.
 * For now this just logs the catch and NEVER throws,
 * so your /catches route always works.
 */
export async function learnFromCatch(input: LearnFromCatchInput): Promise<void> {
  try {
    console.log(
      "[learnFromCatch] (stub) received catch for training:",
      JSON.stringify(input)
    );
    // Later: push into Supabase training table or vector DB.
  } catch (err) {
    console.error("[learnFromCatch] error (ignored in stub):", err);
  }
}
