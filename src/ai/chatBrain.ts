// src/ai/chatBrain.ts
// Central smart AI chat brain for OceanCore

import { config as dotenv } from "dotenv";
dotenv();

import OpenAI from "openai";

type SimpleMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatPayload = {
  question?: string;
  prompt?: string;
  q?: string;
  message?: string;
  text?: string;
  messages?: SimpleMessage[];
  [key: string]: any;
};

// ================================================
// OpenAI client setup
// ================================================
const API_KEY = process.env.OPENAI_API_KEY || "";
const BASE_URL = process.env.OPENAI_BASE_URL || undefined;

// Debug (does NOT print the full key)
console.log(
  "[chatBrain] OPENAI_API_KEY present?",
  API_KEY ? `YES (len=${API_KEY.length})` : "NO"
);
if (BASE_URL) {
  console.log("[chatBrain] Using base URL:", BASE_URL);
}

const openai = API_KEY
  ? new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL, // will be undefined if not set
    })
  : null;

// ================================================
// Helpers
// ================================================
function extractQuestion(body: ChatPayload): string {
  if (!body) return "";
  const cands = [body.question, body.prompt, body.q, body.message, body.text];
  for (const c of cands) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

// ================================================
// Main brain
// ================================================
export async function chatBrain(body: ChatPayload): Promise<any> {
  const question = extractQuestion(body);

  if (!question) {
    return {
      success: false,
      answer: "Ask me something about fishing, boats or conditions.",
    };
  }

  // If the backend truly has no key, do NOT call OpenAI at all
  if (!openai) {
    const msg =
      "OceanCore AI backend does not have OPENAI_API_KEY available at runtime. " +
      "Check your .env file and that the server is started from the project root.";
    console.warn("[chatBrain]", msg);
    return {
      success: false,
      answer: msg,
      error: msg,
      fallback: true,
    };
  }

  const history: SimpleMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m) => m && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content }))
    : [];

  const messages: SimpleMessage[] = [
    {
      role: "system",
      content:
        "You are OceanCore AI, an expert fishing, boating and marine-planning assistant. " +
        "You give short, tactical, Australian-style answers that real fishos can act on.",
    },
    ...history,
    {
      role: "user",
      content: question,
    },
  ];

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.5,
    });

    const answer =
      res.choices?.[0]?.message?.content?.toString().trim() ||
      "I couldn't generate a reply just then.";

    return {
      success: true,
      answer,
      model: res.model,
      usage: res.usage,
    };
  } catch (e: any) {
    console.error("[chatBrain] OpenAI error:", e);

    const status = e?.status;
    const rawMsg =
      e?.error?.message ||
      e?.message ||
      "There was a problem talking to OpenAI.";

    // This is where the 401 text you saw will get passed through
    const msg = status ? `${status} ${rawMsg}` : rawMsg;

    return {
      success: false,
      answer:
        "The AI engine had an issue talking to OpenAI just now.\n\n" +
        "OpenAI error: " +
        msg,
      error: msg,
    };
  }
}
