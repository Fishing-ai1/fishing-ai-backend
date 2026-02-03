// ================================================
// OceanCore AI Backend — Full Predict + Undersize AI Engine
// (SAFE: reads secrets from .env only)
// ================================================

import { config as dotenv } from "dotenv";
dotenv();

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import { learnFromCatch } from "./ai/learnFromCatch";
import { chatBrain } from "./ai/chatBrain";

// Small build ID so we can prove this exact file is running
const BUILD_ID = "OC_BACKEND_2026-01-12_OC4_SPECIES_FIX";

// ================================================
// ENV + clients
// ================================================
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "127.0.0.1";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// IMPORTANT: Your DB table name (set this in .env)
// Example: CATCHES_TABLE=catches OR CATCHES_TABLE=catch_log
const CATCHES_TABLE = process.env.CATCHES_TABLE || "catches";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Debug
console.log(">>> OceanCore AI server.ts LOADED (DEBUG) <<<");
console.log("BUILD_ID:", BUILD_ID);
console.log("ENV HOST:", HOST, "PORT:", PORT);
console.log("SUPABASE_URL:", SUPABASE_URL ? "LOADED" : "MISSING");
console.log("SUPABASE_SERVICE_KEY:", SUPABASE_SERVICE_KEY ? "LOADED" : "MISSING");
console.log("CATCHES_TABLE:", CATCHES_TABLE);
console.log("OPENAI_KEY_PRESENT:", OPENAI_API_KEY ? `YES (len=${OPENAI_API_KEY.length})` : "NO");

export const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

export const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ================================================
// Upload dir
// ================================================
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ================================================
// Fastify app
// ================================================
const app = Fastify({ logger: false });

app.register(cors, { origin: true, credentials: true });
app.register(multipart, {
  attachFieldsToBody: true,
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: "/media/",
});

// ================================================
// Types + in-memory fallback
// ================================================
type CatchOut = {
  id: string;
  user_email?: string | null;
  species: string;
  weight_kg?: number | null;
  length_cm?: number | null;
  lat: number;
  lng: number;
  notes?: string | null;
  photo_url?: string | null;
  created_at: string;
};

const mem: { catches: CatchOut[]; nextId: number } = {
  catches: [],
  nextId: 1,
};

// helpers
function ok<T>(reply: any, body: T) {
  reply.send(body);
}
function err(reply: any, e: any) {
  console.error(e);
  reply.code(500).send({ success: false, error: e?.message || String(e) });
}

function normalizeChatResult(result: any) {
  if (typeof result === "string") return { success: true, answer: result };

  if (result && typeof result === "object") {
    const r: any = result;
    const answer =
      r.answer ??
      r.message ??
      r.reply ??
      r.text ??
      (typeof r.content === "string" ? r.content : "") ??
      "";
    return { success: r.success ?? true, answer, ...r };
  }

  return { success: true, answer: String(result ?? "") };
}

// ================================================
// Save uploaded file (LOCAL fallback)
// ================================================
async function saveUploadedFile(file: any): Promise<string> {
  const original = file?.filename || `photo_${Date.now()}.jpg`;
  const safe = original.replace(/[^\w.\-]/g, "_");
  const name = `${Date.now()}_${Math.random().toString(36).slice(2)}_${safe}`;
  const full = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(full, file.data);
  return `/media/${name}`;
}

// ================================================
// NEW: Upload to Supabase Storage (recommended for real use)
// Bucket: catch-photos (make it PUBLIC for MVP)
// ================================================
async function uploadToSupabaseStorage(
  file: any
): Promise<{ photo_url: string; photo_path: string }> {
  if (!supabase) throw new Error("Supabase not configured");

  const buf: Buffer = file?.data;
  if (!buf || !Buffer.isBuffer(buf)) throw new Error("Invalid upload data");

  const filename = String(file?.filename || "");
  const ext = filename.toLowerCase().endsWith(".png") ? "png" : "jpg";
  const contentType = ext === "png" ? "image/png" : "image/jpeg";

  const safeName = String(filename || `photo_${Date.now()}.${ext}`).replace(
    /[^\w.\-]/g,
    "_"
  );
  const photo_path = `catches/${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("catch-photos")
    .upload(photo_path, buf, { contentType, upsert: true });

  if (upErr) throw upErr;

  const { data } = supabase.storage.from("catch-photos").getPublicUrl(photo_path);
  const photo_url = data?.publicUrl;

  if (!photo_url) throw new Error("Failed to create public URL (bucket may be private)");

  return { photo_url, photo_path };
}

// ================================================
// Supabase helpers (support your UUID schema)
// ================================================
function mapDbCatch(row: any): CatchOut {
  return {
    id: String(row?.id ?? ""),
    user_email: row?.user_email ?? null,
    species: String(row?.species ?? ""),
    weight_kg: row?.weight_kg ?? null,
    length_cm: row?.length_cm ?? null,
    lat: Number(row?.lat ?? 0),
    lng: Number(row?.lng ?? 0),
    notes: row?.notes ?? null,
    photo_url: row?.photo_url ?? null,
    created_at: String(row?.created_at ?? new Date().toISOString()),
  };
}

// Insert expects at least: species, lat, lng, created_at
async function sbInsertCatch(payload: any): Promise<string> {
  if (!supabase) {
    const id = String(mem.nextId++);
    const row: CatchOut = mapDbCatch({ id, ...payload });
    mem.catches.push(row);
    return id;
  }

  const { data, error } = await supabase.from(CATCHES_TABLE).insert(payload).select("*").single();

  if (error) throw error;
  return String(data?.id);
}

async function sbListCatches(limit = 200): Promise<CatchOut[]> {
  if (!supabase) {
    return [...mem.catches]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, limit);
  }

  const { data, error } = await supabase
    .from(CATCHES_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(mapDbCatch);
}

async function sbAllCatches(): Promise<CatchOut[]> {
  if (!supabase) return [...mem.catches];

  const { data, error } = await supabase
    .from(CATCHES_TABLE)
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapDbCatch);
}

// ================================================
// Routes — Base + health
// ================================================
app.get("/", async (_req, reply) => {
  ok(reply, { ok: true, note: "OceanCore AI Backend running.", build: BUILD_ID });
});

app.get("/health", async (_req, reply) => {
  ok(reply, {
    success: true,
    ok: true,
    build: BUILD_ID,
    supabase: !!supabase,
    table: CATCHES_TABLE,
    ai: !!openai,
    uploads: true,
    uptime: process.uptime(),
  });
});

// ================================================
// Catches list
// ================================================
app.get("/catches", async (_req, reply) => {
  try {
    ok(reply, await sbListCatches(200));
  } catch (e) {
    err(reply, e);
  }
});

// ================================================
// NEW ROUTE: Upload catch photo to Supabase Storage
// ================================================
app.post("/catches/photo", async (req: any, reply) => {
  try {
    const b = req.body || {};

    // DEBUG (helps catch "silent" failures)
    console.log("[/catches/photo] keys:", Object.keys(b));
    console.log("[/catches/photo] has photo:", !!b.photo, "filename:", b.photo?.filename);

    if (!b.photo) return reply.code(400).send({ success: false, error: "photo field required" });

    const out = await uploadToSupabaseStorage(b.photo);
    ok(reply, { success: true, ...out });
  } catch (e: any) {
    console.error("[/catches/photo] ERROR:", e?.message || e);
    err(reply, e);
  }
});

// ================================================
// Insert catch (JSON)
// ================================================
app.post("/catches", async (req: any, reply) => {
  try {
    const b = req.body || {};

    const species = String(b.species || "").trim();
    if (!species) {
      return reply.code(400).send({ success: false, error: "species required" });
    }

    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send({ success: false, error: "lat/lng required" });
    }

    const created_at = b.created_at || new Date().toISOString();

    const payload: any = {
      user_email: b.user_email ?? "guest@example.com",
      species,
      weight_kg: b.weight_kg != null ? Number(b.weight_kg) : null,
      length_cm: b.length_cm != null ? Number(b.length_cm) : null,
      lat,
      lng,
      notes: b.notes ?? null,
      photo_url: b.photo_url ?? null,
      created_at,

      owner_uid: b.owner_uid ?? b.ownerUid ?? null,
      share_scope: b.share_scope ?? b.shareScope ?? "private",
      team_id: b.team_id ?? b.teamId ?? null,
      water_temp_c: b.water_temp_c ?? null,
      air_temp_c: b.air_temp_c ?? null,
      current_kn: b.current_kn ?? null,
      wind_dir_deg: b.wind_dir_deg ?? null,
      legal_size: b.legal_size ?? null,
    };

    const id = await sbInsertCatch(payload);

    await learnFromCatch({
      user_email: payload.user_email,
      species,
      weight_kg: payload.weight_kg,
      length_cm: payload.length_cm,
      lat,
      lng,
      notes: payload.notes || "",
      created_at,
    });

    ok(reply, { success: true, id });
  } catch (e) {
    err(reply, e);
  }
});

// ================================================
// Insert with photo (LOCAL file save fallback)
// ================================================
app.post("/catches/with-photo", async (req: any, reply) => {
  try {
    const b = req.body || {};

    const species = String(b.species || "").trim();
    if (!species) {
      return reply.code(400).send({ success: false, error: "species required" });
    }

    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send({ success: false, error: "lat/lng required" });
    }

    let photo_url: string | null = null;
    if (b.photo) photo_url = await saveUploadedFile(b.photo);

    const created_at = b.created_at || new Date().toISOString();

    const payload: any = {
      user_email: b.user_email ?? "guest@example.com",
      species,
      weight_kg: b.weight_kg != null ? Number(b.weight_kg) : null,
      length_cm: b.length_cm != null ? Number(b.length_cm) : null,
      lat,
      lng,
      notes: b.notes ?? null,
      photo_url,
      created_at,

      owner_uid: b.owner_uid ?? b.ownerUid ?? null,
      share_scope: b.share_scope ?? b.shareScope ?? "private",
      team_id: b.team_id ?? b.teamId ?? null,
      water_temp_c: b.water_temp_c ?? null,
      air_temp_c: b.air_temp_c ?? null,
      current_kn: b.current_kn ?? null,
      wind_dir_deg: b.wind_dir_deg ?? null,
      legal_size: b.legal_size ?? null,
    };

    const id = await sbInsertCatch(payload);

    await learnFromCatch({
      user_email: payload.user_email,
      species,
      weight_kg: payload.weight_kg,
      length_cm: payload.length_cm,
      lat,
      lng,
      notes: payload.notes || "",
      created_at,
    });

    ok(reply, { success: true, id, photo_url });
  } catch (e) {
    err(reply, e);
  }
});

// ================================================
// Queue Sync stub (frontend expects it)
// ================================================
app.all("/queue/sync", async (_req, reply) => {
  ok(reply, { success: true, queued: 0, note: "sync stub" });
});

// ... (REST OF YOUR FILE IS UNCHANGED BELOW THIS LINE)
// ================================================
// AI Species Detection (Vision) — UPGRADED
// ================================================
type SpeciesDetectResult = {
  species: string; // common name
  scientific_name?: string;
  confidence: number; // 0..1
  alternatives: Array<{ species: string; confidence: number }>;
  reason: string;
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function cleanName(s: any) {
  return String(s || "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleish(s: string) {
  const x = cleanName(s);
  if (!x) return x;
  return x
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

// (keep the rest of your existing routes exactly as they were)

// ================================================
// Aliases — because frontend uses many paths
// ================================================
const alias = (from: string, to: string) => {
  app.all(from, async (req: any, reply: any) => {
    const query = req.raw.url?.split("?")[1] ?? "";
    const targetUrl = `${to}${query ? "?" + query : ""}`;

    const res = await app.inject({
      method: req.method,
      url: targetUrl,
      payload: req.body,
    });

    let body: any = res.body;
    try {
      body = body ? JSON.parse(body as any) : undefined;
    } catch {}

    reply.code(res.statusCode).headers(res.headers).send(body);
  });
};

alias("/api/catches/photo", "/catches/photo"); // ✅ FIXED: correct placement

// keep your existing alias calls here (unchanged)
alias("/api/undersized", "/undersized");
alias("/api/patterns", "/patterns");
alias("/api/ai/patterns", "/ai/patterns");
alias("/api/ai/predict", "/ai/patterns");
alias("/api/predict", "/predict/now");
alias("/api/ramps", "/places/ramps");
alias("/api/ramps/nearby", "/places/ramps");
alias("/api/boat/fuel-plan", "/boat/fuel-plan");

alias("/api/chat", "/ai/chat/smart");
alias("/api/chat/brain", "/ai/chat/smart");
alias("/ai/chat", "/ai/chat/smart");
alias("/chat/smart", "/ai/chat/smart");
alias("/api/ai/chat", "/ai/chat/smart");

// ================================================
// Not Found handler
// ================================================
app.setNotFoundHandler(async (req: any, reply: any) => {
  reply.code(404).send({
    success: false,
    error: "Not found",
    method: req.method,
    url: req.url,
  });
});

// ================================================
// Route dump for debugging
// ================================================
let ROUTES_DUMP = "";
app.ready((err) => {
  if (err) return console.error("Fastify ready error:", err);
  ROUTES_DUMP = app.printRoutes();
  console.log("=== Registered routes ===");
  console.log(ROUTES_DUMP);
});

app.get("/__debug/routes", async (_req, reply) => {
  ok(reply, { build: BUILD_ID, routes: ROUTES_DUMP });
});

// ================================================
// START SERVER
// ================================================
async function start() {
  try {
    await app.listen({ host: HOST, port: PORT });
    console.log(`Fishing AI backend LIVE at http://${HOST}:${PORT}`);
  } catch (e) {
    console.error("Boot error:", e);
    process.exit(1);
  }
}

start();
