// src/ai/embed.ts

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

/**
 * Simple, safe embedding helper.
 * Returns a vector array, or null on error.
 * For now, chatBrain does NOT depend on this – it’s safe to keep as a helper.
 */
export async function embedText(
  text: string
): Promise<number[] | null> {
  text = String(text || "").trim();
  if (!text) return null;

  if (!process.env.OPENAI_API_KEY) {
    console.warn("embedText: no OPENAI_API_KEY, returning null.");
    return null;
  }

  try {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    const vec = res.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch (err) {
    console.error("Embedding error (caught in embedText):", err);
    return null;
  }
}
