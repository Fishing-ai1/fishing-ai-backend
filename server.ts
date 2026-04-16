// OceanCore slim backend FINAL: auth + per-user profile fixed
// src/server.ts
// ============================================================
// OceanCore AI — SLIM BETA BACKEND
// Core only:
// - Auth / profile / legal
// - Catch log
// - AI chat
// - Ramps & fuel
// - Weather / swell
// ============================================================

import { config as dotenv } from "dotenv";
dotenv();

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUILD_ID = "OC_BACKEND_2026-04-15_V10_PUBLIC_LAUNCH_POLISH";

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const WINDY_POINT_FORECAST_KEY = process.env.WINDY_POINT_FORECAST_KEY || "";

const CATCHES_TABLE = process.env.CATCHES_TABLE || "catches";
const PROFILES_TABLE = process.env.PROFILES_TABLE || "profiles";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";

const DEV_GUEST_USER_ID =
  process.env.DEV_GUEST_USER_ID || "00000000-0000-0000-0000-000000000000";
const DEV_GUEST_EMAIL = process.env.DEV_GUEST_EMAIL || "guest@oceancore.local";

const LEGAL_VERSION = "2026-04-05-slim-beta-1";
const LEGAL_CONTACT_EMAIL = "support@oceancore.ai";

const LEGAL_DOCS = {
  version: LEGAL_VERSION,
  contact_email: LEGAL_CONTACT_EMAIL,
  terms: `OceanCore AI Beta Terms

OceanCore AI is a beta product. Features may change, fail, or be removed without notice.

You are responsible for your vessel, weather checks, trip planning, and compliance decisions. OceanCore AI is an information tool only. Do not rely on it as your only source for marine safety, legal limits, or navigation.

By using the beta, you agree not to misuse the service, interfere with the platform, or upload unlawful or harmful content.

You keep ownership of the content you upload, and you give OceanCore AI permission to process and store it as needed to operate and improve the service.

To the maximum extent permitted by law, OceanCore AI is not liable for indirect or consequential loss arising from beta use.

Contact: ${LEGAL_CONTACT_EMAIL}`,
  privacy: `OceanCore AI Beta Privacy Policy

We may collect account details, catch logs, notes, photos, AI prompts, AI responses, and location information you choose to provide.

We use this data to run the product, support sync, improve results, troubleshoot issues, and protect the service.

We do not sell your personal information. We may use service providers to host data and provide infrastructure.

Because this is a beta, product behavior and data flows may still change.

Contact: ${LEGAL_CONTACT_EMAIL}`,
  disclaimer: `OceanCore AI Marine Disclaimer

OceanCore AI is not a substitute for official forecasts, notices to mariners, navigation charts, local knowledge, or seamanship.

Fishing advice, weather signals, swell signals, and tactical suggestions are estimates only.

Always verify conditions, laws, and safety requirements independently before going on the water.`,
  beta_notice: `OceanCore AI is in beta. Use caution before relying on outputs in real-world marine conditions.`,
};

type AuthUser = {
  id: string;
  email: string | null;
  isGuest: boolean;
  user_metadata?: Record<string, any> | null;
};

type ProfileRow = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  username?: string | null;
  boat_name?: string | null;
  home_port?: string | null;
  favourite_species?: string | null;
  role_plan?: string | null;
  avatar_url?: string | null;
  accepted_terms_at?: string | null;
  accepted_privacy_at?: string | null;
  accepted_disclaimer_at?: string | null;
  legal_version?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CatchRow = {
  id: string;
  user_id?: string | null;
  user_email?: string | null;
  species: string;
  weight_kg?: number | null;
  length_cm?: number | null;
  legal_limit_cm?: number | null;
  is_legal?: boolean | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  photo_url?: string | null;
  created_at: string;
};

type NearbyPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance_km: number;
  address?: string;
  brand?: string;
  source: string;
};

const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const SUPABASE_AUTH_API_KEY = SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY;

async function callSupabaseAuth(path: string, payload: Record<string, any>) {
  if (!SUPABASE_URL || !SUPABASE_AUTH_API_KEY) {
    throw new Error("Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_AUTH_API_KEY,
      Authorization: `Bearer ${SUPABASE_AUTH_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text || `Supabase auth request failed (${res.status})` };
  }

  if (!res.ok) {
    throw new Error(
      json?.msg ||
        json?.error_description ||
        json?.error ||
        `Supabase auth request failed (${res.status})`
    );
  }

  return json || {};
}

function formatSessionPayload(data: any = {}) {
  if (!data?.access_token) return null;
  const expiresIn = data.expires_in ?? null;
  const expiresAt = data.expires_at ?? (expiresIn ? Math.floor(Date.now() / 1000) + Number(expiresIn) : null);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: data.token_type ?? "bearer",
    user: data.user ?? null,
  };
}

function pickMetaString(meta: any, keys: string[]) {
  const src = meta || {};
  for (const key of keys) {
    const value = src?.[key];
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return null;
}

function profileFromMetadata(user: AuthUser): ProfileRow {
  const meta = user.user_metadata || {};
  return normalizeProfile({
    id: user.id,
    email: user.email ?? null,
    full_name: pickMetaString(meta, ["full_name", "fullName", "name"]),
    username: pickMetaString(meta, ["username", "user_name"]),
    boat_name: pickMetaString(meta, ["boat_name", "boatName"]),
    home_port: pickMetaString(meta, ["home_port", "homePort"]),
    favourite_species: pickMetaString(meta, ["favourite_species", "favorite_species", "favouriteSpecies", "favoriteSpecies"]),
    role_plan: pickMetaString(meta, ["role_plan", "role", "roleLabel", "role_label"]),
    avatar_url: pickMetaString(meta, ["avatar_url", "avatarUrl"]),
    accepted_terms_at: pickMetaString(meta, ["accepted_terms_at"]),
    accepted_privacy_at: pickMetaString(meta, ["accepted_privacy_at"]),
    accepted_disclaimer_at: pickMetaString(meta, ["accepted_disclaimer_at"]),
    legal_version: pickMetaString(meta, ["legal_version"]) || LEGAL_VERSION,
  });
}

function metadataFromProfile(profile: ProfileRow) {
  return {
    full_name: profile.full_name ?? null,
    username: profile.username ?? null,
    boat_name: profile.boat_name ?? null,
    home_port: profile.home_port ?? null,
    favourite_species: profile.favourite_species ?? null,
    role_plan: profile.role_plan ?? null,
    avatar_url: profile.avatar_url ?? null,
    accepted_terms_at: profile.accepted_terms_at ?? null,
    accepted_privacy_at: profile.accepted_privacy_at ?? null,
    accepted_disclaimer_at: profile.accepted_disclaimer_at ?? null,
    legal_version: profile.legal_version ?? LEGAL_VERSION,
  };
}

async function syncProfileMetadata(userId: string, profile: ProfileRow) {
  if (!supabase || !userId || userId === DEV_GUEST_USER_ID) return;
  try {
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: metadataFromProfile(profile),
    });
  } catch (e) {
    console.warn("syncProfileMetadata failed", e);
  }
}

async function callSupabaseUpdateUser(accessToken: string, payload: Record<string, any>) {
  if (!SUPABASE_URL || !SUPABASE_AUTH_API_KEY) {
    throw new Error("Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_AUTH_API_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text || `Supabase auth request failed (${res.status})` };
  }

  if (!res.ok) {
    throw new Error(
      json?.msg ||
        json?.error_description ||
        json?.error ||
        `Supabase auth request failed (${res.status})`
    );
  }

  return json || {};
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = Fastify({
  logger: false,
  bodyLimit: 25 * 1024 * 1024,
});

app.register(cors, { origin: true, credentials: true });
app.register(multipart, { attachFieldsToBody: true });
app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: "/media/" });

const mem = {
  profiles: new Map<string, ProfileRow>(),
  catches: [] as CatchRow[],
};

function ok<T>(reply: any, body: T) {
  reply.send(body);
}

function fail(reply: any, error: unknown, status = 500) {
  console.error(error);
  reply.code(status).send({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function unwrapBodyValue<T = any>(value: T): any {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value) &&
    "value" in (value as any)
  ) {
    return (value as any).value;
  }
  return value;
}

function str(v: any, fallback = ""): string {
  const raw = unwrapBodyValue(v);
  if (raw == null) return fallback;
  const s = String(raw).trim();
  return s || fallback;
}

function num(v: any): number | null {
  const raw = unwrapBodyValue(v);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function bool(v: any): boolean | null {
  const raw = unwrapBodyValue(v);
  if (raw == null || raw === "") return null;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  return null;
}

function cleanSpecies(v: any) {
  const value = str(v, "Unknown").replace(/\s+/g, " ").trim();
  if (!value) return "Unknown";
  return value[0].toUpperCase() + value.slice(1);
}

function toIso(v: any): string | null {
  const raw = unwrapBodyValue(v);
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const p1 = toRad(aLat);
  const p2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function isDataUrlImage(v: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(v || "").trim());
}

function makeAbsoluteMediaUrl(req: any, url: string | null | undefined) {
  const value = String(url || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:image/")) return value;
  if (!value.startsWith("/media/")) return value;
  const proto =
    String(req?.headers?.["x-forwarded-proto"] || "").trim() || "http";
  const host = String(req?.headers?.host || "").trim() || `${HOST}:${PORT}`;
  return `${proto}://${host}${value}`;
}

function getBearerToken(req: any): string {
  const raw = String(req?.headers?.authorization || "").trim();
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

async function getAuthUser(req: any): Promise<AuthUser> {
  if (!supabase) {
    return {
      id: DEV_GUEST_USER_ID,
      email: DEV_GUEST_EMAIL,
      isGuest: true,
      user_metadata: {},
    };
  }

  const token = getBearerToken(req);
  if (!token) {
    return {
      id: DEV_GUEST_USER_ID,
      email: DEV_GUEST_EMAIL,
      isGuest: true,
      user_metadata: {},
    };
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      return {
        id: DEV_GUEST_USER_ID,
        email: DEV_GUEST_EMAIL,
        isGuest: true,
        user_metadata: {},
      };
    }
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      isGuest: false,
      user_metadata: ((data.user as any)?.user_metadata || {}) as Record<string, any>,
    };
  } catch {
    return {
      id: DEV_GUEST_USER_ID,
      email: DEV_GUEST_EMAIL,
      isGuest: true,
      user_metadata: {},
    };
  }
}

async function getRequiredAuthUser(req: any): Promise<AuthUser> {
  if (!supabase) {
    throw new Error("Supabase is not configured on the backend.");
  }
  const token = getBearerToken(req);
  if (!token) {
    throw new Error("Not signed in. Sign in first.");
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new Error("Your session is invalid or expired. Sign in again.");
  }
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    isGuest: false,
    user_metadata: ((data.user as any)?.user_metadata || {}) as Record<string, any>,
  };
}

function normalizeProfile(row: any = {}) {
  return {
    id: row.id || DEV_GUEST_USER_ID,
    email: row.email ?? null,
    full_name: row.full_name ?? null,
    username: row.username ?? null,
    boat_name: row.boat_name ?? null,
    home_port: row.home_port ?? null,
    favourite_species: row.favourite_species ?? null,
    role_plan: row.role_plan ?? null,
    avatar_url: row.avatar_url ?? null,
    accepted_terms_at: row.accepted_terms_at ?? null,
    accepted_privacy_at: row.accepted_privacy_at ?? null,
    accepted_disclaimer_at: row.accepted_disclaimer_at ?? null,
    legal_version: row.legal_version ?? LEGAL_VERSION,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function getProfileForUser(user: AuthUser): Promise<ProfileRow> {
  const metaProfile = profileFromMetadata(user);

  if (!supabase || user.isGuest) {
    return normalizeProfile(
      mem.profiles.get(user.id) || { ...metaProfile, id: user.id, email: user.email }
    );
  }

  const existing = await supabase
    .from(PROFILES_TABLE)
    .select(
      "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,created_at,updated_at"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (existing.data) {
    const merged = normalizeProfile({ ...metaProfile, ...existing.data, id: user.id, email: user.email });
    await syncProfileMetadata(user.id, merged);
    return merged;
  }

  if (existing.error && (existing.error as any)?.code !== "PGRST116") {
    return metaProfile;
  }

  const created = await supabase
    .from(PROFILES_TABLE)
    .upsert(
      {
        ...metaProfile,
        id: user.id,
        email: user.email,
        legal_version: metaProfile.legal_version || LEGAL_VERSION,
      },
      { onConflict: "id" }
    )
    .select(
      "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,created_at,updated_at"
    )
    .single();

  if (created.error) {
    return metaProfile;
  }

  const merged = normalizeProfile({ ...metaProfile, ...created.data, id: user.id, email: user.email });
  await syncProfileMetadata(user.id, merged);
  return merged;
}

async function saveProfileForUser(user: AuthUser, patch: Partial<ProfileRow>) {
  const currentMeta = profileFromMetadata(user);
  const payload: ProfileRow = normalizeProfile({
    ...currentMeta,
    ...patch,
    id: user.id,
    email: patch.email ?? user.email ?? null,
    legal_version: patch.legal_version ?? currentMeta.legal_version ?? LEGAL_VERSION,
  });

  if (!supabase || user.isGuest) {
    const current = normalizeProfile(mem.profiles.get(user.id) || {});
    const merged = normalizeProfile({ ...current, ...payload, id: user.id });
    mem.profiles.set(user.id, merged);
    return merged;
  }

  const saved = await supabase
    .from(PROFILES_TABLE)
    .upsert(payload, { onConflict: "id" })
    .select(
      "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,created_at,updated_at"
    )
    .single();

  if (saved.error) {
    await syncProfileMetadata(user.id, payload);
    return payload;
  }

  const merged = normalizeProfile({ ...payload, ...saved.data, id: user.id });
  await syncProfileMetadata(user.id, merged);
  return merged;
}

async function listUserCatches(user: AuthUser, limit = 100): Promise<CatchRow[]> {
  if (!supabase) {
    return mem.catches
      .filter((x) => (x.user_id || DEV_GUEST_USER_ID) === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  const res = await supabase
    .from(CATCHES_TABLE)
    .select(
      "id,user_id,user_email,species,weight_kg,length_cm,legal_limit_cm,is_legal,lat,lng,notes,photo_url,created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (res.error) throw res.error;
  return (res.data || []) as CatchRow[];
}

async function insertCatch(user: AuthUser, payload: Partial<CatchRow>): Promise<CatchRow> {
  const row: CatchRow = {
    id: crypto.randomUUID(),
    user_id: user.id,
    user_email: user.email ?? null,
    species: cleanSpecies(payload.species),
    weight_kg: payload.weight_kg ?? null,
    length_cm: payload.length_cm ?? null,
    legal_limit_cm: payload.legal_limit_cm ?? null,
    is_legal:
      payload.length_cm != null && payload.legal_limit_cm != null
        ? payload.length_cm >= payload.legal_limit_cm
        : payload.is_legal ?? null,
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    notes: str(payload.notes, "") || null,
    photo_url: payload.photo_url ?? null,
    created_at: new Date().toISOString(),
  };

  if (!supabase) {
    mem.catches.unshift(row);
    return row;
  }

  const saved = await supabase
    .from(CATCHES_TABLE)
    .insert({
      user_id: row.user_id,
      user_email: row.user_email,
      species: row.species,
      weight_kg: row.weight_kg,
      length_cm: row.length_cm,
      legal_limit_cm: row.legal_limit_cm,
      is_legal: row.is_legal,
      lat: row.lat,
      lng: row.lng,
      notes: row.notes,
      photo_url: row.photo_url,
    })
    .select(
      "id,user_id,user_email,species,weight_kg,length_cm,legal_limit_cm,is_legal,lat,lng,notes,photo_url,created_at"
    )
    .single();

  if (saved.error) throw saved.error;
  return saved.data as CatchRow;
}

async function deleteCatch(user: AuthUser, catchId: string) {
  if (!supabase) {
    const before = mem.catches.length;
    mem.catches = mem.catches.filter(
      (x) => !(x.id === catchId && (x.user_id || DEV_GUEST_USER_ID) === user.id)
    );
    return before !== mem.catches.length;
  }

  const deleted = await supabase
    .from(CATCHES_TABLE)
    .delete()
    .eq("id", catchId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (deleted.error && (deleted.error as any)?.code !== "PGRST116") {
    throw deleted.error;
  }

  return !!deleted.data?.id;
}

function summarizeCatchStats(rows: CatchRow[]) {
  const total = rows.length;
  const speciesCounts = new Map<string, number>();
  let legalKnown = 0;
  let legalCount = 0;

  for (const row of rows) {
    const key = cleanSpecies(row.species);
    speciesCounts.set(key, (speciesCounts.get(key) || 0) + 1);
    if (typeof row.is_legal === "boolean") {
      legalKnown += 1;
      if (row.is_legal) legalCount += 1;
    }
  }

  const knownSpecies = [...speciesCounts.entries()].filter(([species]) => species !== "Unknown");
  const rankedSpecies = (knownSpecies.length ? knownSpecies : [...speciesCounts.entries()])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([species, count]) => ({ species, count }));

  const latest = rows.find((row) => cleanSpecies(row.species) !== "Unknown") || rows[0] || null;
  const legalRatio = legalKnown ? round2((legalCount / legalKnown) * 100) : null;

  return {
    total_catches: total,
    latest_catch: latest,
    top_species: rankedSpecies,
    legal_ratio_percent: legalRatio,
  };
}

async function saveDataUrlImage(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) throw new Error("Invalid image data URL");

  const mime = match[1].toLowerCase();
  const base64 = match[2];
  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/webp"
      ? "webp"
      : mime === "image/gif"
      ? "gif"
      : "jpg";

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filepath, Buffer.from(base64, "base64"));
  return `/media/${filename}`;
}

function normalizeAddress(tags: Record<string, any> = {}) {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"] || tags["addr:city"] || tags["addr:town"],
    tags["addr:state"],
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  if (parts.length) return parts.join(", ");
  return "";
}

async function fetchOverpass(query: string) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": "OceanCoreAI/1.0",
        },
        body: query,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Overpass failed (${res.status})`);
      }

      const json = (await res.json()) as any;
      return Array.isArray(json?.elements) ? json.elements : [];
    } catch (e) {
      lastError = e;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const msg =
    lastError instanceof Error
      ? lastError.name === "AbortError"
        ? "Overpass timed out"
        : lastError.message
      : String(lastError || "Overpass request failed");
  throw new Error(msg);
}

async function searchNearbyPlaces(
  kind: "ramps" | "fuel",
  lat: number,
  lng: number,
  radiusKm: number
): Promise<NearbyPlace[]> {
  const radiusM = clamp(Math.round(radiusKm * 1000), 1000, 100000);

  const body =
    kind === "ramps"
      ? `[out:json][timeout:20];
(
  node["amenity"="boat_ramp"](around:${radiusM},${lat},${lng});
  way["amenity"="boat_ramp"](around:${radiusM},${lat},${lng});
  node["leisure"="slipway"](around:${radiusM},${lat},${lng});
  way["leisure"="slipway"](around:${radiusM},${lat},${lng});
  node["man_made"="slipway"](around:${radiusM},${lat},${lng});
  way["man_made"="slipway"](around:${radiusM},${lat},${lng});
  node["waterway"="slipway"](around:${radiusM},${lat},${lng});
  way["waterway"="slipway"](around:${radiusM},${lat},${lng});
  node["slipway"="yes"](around:${radiusM},${lat},${lng});
  way["slipway"="yes"](around:${radiusM},${lat},${lng});
  node["boat_ramp"="yes"](around:${radiusM},${lat},${lng});
  way["boat_ramp"="yes"](around:${radiusM},${lat},${lng});
);
out center tags;`
      : `[out:json][timeout:20];
(
  node["amenity"="fuel"](around:${radiusM},${lat},${lng});
  way["amenity"="fuel"](around:${radiusM},${lat},${lng});
);
out center tags;`;

  const elements = await fetchOverpass(body);

  const mapped = elements
    .map((el: any, index: number) => {
      const pLat = Number(el.lat ?? el.center?.lat);
      const pLng = Number(el.lon ?? el.center?.lon);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;

      const tags = el.tags || {};
      const name =
        str(tags.name) ||
        (kind === "ramps" ? "Boat ramp" : str(tags.brand) || "Fuel");
      const address = normalizeAddress(tags);
      const distance_km = round2(haversineKm(lat, lng, pLat, pLng)) || 0;
      const isGenericRamp = kind === "ramps" && /^boat ramp$/i.test(name);

      return {
        id: String(el.id || `${kind}-${index}`),
        name,
        lat: pLat,
        lng: pLng,
        distance_km,
        address: address || undefined,
        brand: kind === "fuel" ? str(tags.brand) || undefined : undefined,
        source: "overpass",
        isGenericRamp,
      } as NearbyPlace & { isGenericRamp?: boolean };
    })
    .filter(Boolean) as Array<NearbyPlace & { isGenericRamp?: boolean }>;

  const seen = new Set<string>();
  const sorted = mapped.sort((a, b) => {
    const rankA = a.isGenericRamp ? 1 : 0;
    const rankB = b.isGenericRamp ? 1 : 0;
    return rankA - rankB || a.distance_km - b.distance_km;
  });

  const output: NearbyPlace[] = [];
  let genericRampCount = 0;
  let genericFuelCount = 0;

  for (const item of sorted) {
    const key = item.isGenericRamp
      ? `${item.name}|${item.lat.toFixed(3)}|${item.lng.toFixed(3)}`
      : `${item.name}|${String(item.address || item.brand || "").trim()}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;

    if (seen.has(key)) continue;
    seen.add(key);

    const isGenericFuel =
      kind === "fuel" &&
      !String(item.address || "").trim() &&
      !String(item.brand || "").trim() &&
      /^fuel$/i.test(item.name);

    if (kind === "ramps" && item.isGenericRamp) {
      genericRampCount += 1;
      if (genericRampCount > 4 && output.length >= 4) continue;
    }

    if (isGenericFuel) {
      genericFuelCount += 1;
      if (genericFuelCount > 3 && output.length >= 4) continue;
    }

    const { isGenericRamp, ...cleanItem } = item;
    output.push(cleanItem);

    const maxResults = kind === "ramps" ? 10 : 10;
    if (output.length >= maxResults) break;
  }

  return output;
}

function signalFromConditions(windKts: number | null, gustKts: number | null, waveM: number | null) {
  const wind = windKts ?? 0;
  const gust = gustKts ?? 0;
  const wave = waveM ?? 0;

  if (wind <= 12 && gust <= 18 && wave <= 0.8) return "green";
  if (wind <= 18 && gust <= 25 && wave <= 1.5) return "amber";
  return "red";
}

function msToKts(ms: number | null) {
  return ms == null ? null : round2(ms * 1.943844);
}

function tsToIso(ts: number | null | undefined) {
  if (ts == null || !Number.isFinite(Number(ts))) return new Date().toISOString();
  return new Date(Number(ts)).toISOString();
}

function pickWindyStartIndex(tsList: number[], nowMs: number) {
  if (!tsList.length) return 0;
  const futureish = tsList.findIndex((ts) => ts >= nowMs - (30 * 60 * 1000));
  if (futureish >= 0) return futureish;
  return Math.max(0, tsList.length - 12);
}

async function fetchWindyPointForecast(input: {
  lat: number;
  lng: number;
  model: "gfs" | "gfsWave";
  parameters: string[];
}) {
  const res = await fetch("https://api.windy.com/api/point-forecast/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "OceanCoreAI/1.0",
    },
    body: JSON.stringify({
      lat: input.lat,
      lon: input.lng,
      model: input.model,
      parameters: input.parameters,
      levels: ["surface"],
      key: WINDY_POINT_FORECAST_KEY,
    }),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text || `Windy request failed (${res.status})` };
  }

  if (!res.ok) {
    throw new Error(
      json?.message ||
        json?.error ||
        json?.detail ||
        `Windy request failed (${res.status})`
    );
  }

  return json || {};
}

async function getMarineForecast(lat: number, lng: number) {
  const unavailable = (warning: string, sourceStatus = "windy_unavailable") => ({
    success: true,
    location: { lat, lng },
    signal: "amber",
    current: {
      time: new Date().toISOString(),
      time_unix_ms: Date.now(),
      wind_kts: null,
      gust_kts: null,
      wave_m: null,
      swell_m: null,
      swell_period_s: null,
      sea_surface_temp_c: null,
      rain_chance_percent: null,
      signal: "amber",
      source_status: sourceStatus,
      source_name: "Windy Point Forecast API",
      wind_model: "gfs",
      wave_model: "gfsWave",
    },
    hours: [],
    current_index: 0,
    current_basis: "nearest_future_forecast_slot",
    partial: true,
    source_status: sourceStatus,
    source_name: "Windy Point Forecast API",
    wind_model: "gfs",
    wave_model: "gfsWave",
    wind_model_label: "GFS",
    wave_model_label: "GFS Wave",
    warning,
  });

  if (!WINDY_POINT_FORECAST_KEY) {
    return unavailable(
      "Windy forecast is not configured on the backend yet. Add WINDY_POINT_FORECAST_KEY to .env.",
      "windy_unconfigured"
    );
  }

  try {
    const [windData, waveData] = await Promise.all([
      fetchWindyPointForecast({
        lat,
        lng,
        model: "gfs",
        parameters: ["wind", "windGust", "precip"],
      }),
      fetchWindyPointForecast({
        lat,
        lng,
        model: "gfsWave",
        parameters: ["waves", "swell1"],
      }),
    ]);

    const timestamps = [
      ...(Array.isArray(windData?.ts) ? windData.ts : []),
      ...(Array.isArray(waveData?.ts) ? waveData.ts : []),
    ]
      .filter((x: any) => Number.isFinite(Number(x)))
      .map((x: any) => Number(x));

    const uniqueTs = [...new Set(timestamps)].sort((a, b) => a - b);
    if (!uniqueTs.length) {
      return unavailable("Windy forecast returned no time series for this location.");
    }

    const nowMs = Date.now();
    const startIndex = pickWindyStartIndex(uniqueTs, nowMs);
    const displayTs = uniqueTs.slice(startIndex, startIndex + 12);
    const currentIndex = 0;

    const windIndex = new Map<number, number>();
    const waveIndex = new Map<number, number>();
    (Array.isArray(windData?.ts) ? windData.ts : []).forEach((ts: any, i: number) => {
      if (Number.isFinite(Number(ts))) windIndex.set(Number(ts), i);
    });
    (Array.isArray(waveData?.ts) ? waveData.ts : []).forEach((ts: any, i: number) => {
      if (Number.isFinite(Number(ts))) waveIndex.set(Number(ts), i);
    });

    const hours = displayTs.map((ts) => {
      const wi = windIndex.get(ts);
      const wvi = waveIndex.get(ts);

      const windU = wi == null ? null : num(windData?.["wind_u-surface"]?.[wi]);
      const windV = wi == null ? null : num(windData?.["wind_v-surface"]?.[wi]);
      const gustMs = wi == null ? null : num(windData?.["gust-surface"]?.[wi]);
      const waveM = wvi == null ? null : num(waveData?.["waves_height-surface"]?.[wvi]);
      const swellM = wvi == null ? null : num(waveData?.["swell1_height-surface"]?.[wvi]);
      const swellPeriodS = wvi == null ? null : num(waveData?.["swell1_period-surface"]?.[wvi]);

      const windMs =
        windU == null || windV == null ? null : Math.sqrt((windU ** 2) + (windV ** 2));
      const windKts = msToKts(windMs);
      const gustKts = msToKts(gustMs);

      return {
        time: tsToIso(ts),
        time_unix_ms: ts,
        wind_kts: windKts,
        gust_kts: gustKts,
        wave_m: waveM,
        swell_m: swellM,
        swell_period_s: swellPeriodS,
        sea_surface_temp_c: null,
        rain_chance_percent: null,
        signal: signalFromConditions(windKts, gustKts, waveM),
        source_status: "windy_live",
        source_name: "Windy Point Forecast API",
        wind_model: "gfs",
        wave_model: "gfsWave",
      };
    });

    const current = hours[currentIndex] || hours[0] || null;

    return {
      success: true,
      location: { lat, lng },
      signal: current?.signal || "amber",
      current,
      current_index: currentIndex,
      current_basis: "nearest_future_forecast_slot",
      hours,
      partial: false,
      source_status: "windy_live",
      source_name: "Windy Point Forecast API",
      wind_model: "gfs",
      wave_model: "gfsWave",
      wind_model_label: "GFS",
      wave_model_label: "GFS Wave",
      warning: null,
    };
  } catch (error) {
    console.warn("windy marine forecast unavailable", error);
    return unavailable(
      error instanceof Error
        ? `Live Windy forecast is unavailable right now. ${error.message}`
        : "Live Windy forecast is unavailable right now."
    );
  }
}

function detectMode(question: string) {
  const q = question.toLowerCase();
  if (/(legal size|bag limit|regulation|rules|limit\b|closed season)/i.test(q))
    return "regulations";
  if (/(where|launch|ramp|fuel|trip|plan|window|best time|today|tomorrow)/i.test(q))
    return "trip";
  if (/(weather|wind|swell|wave|sea state|forecast)/i.test(q))
    return "conditions";
  if (/(fish|fishing|tuna|snapper|flathead|whiting|bait|lure|rig|reef|pelagic)/i.test(q))
    return "fishing";
  return "general";
}

function compactJson(value: unknown, maxLen = 6000) {
  const raw = JSON.stringify(value ?? null, null, 2);
  return raw.length > maxLen ? raw.slice(0, maxLen) + "\n...[truncated]" : raw;
}

async function buildSmartReply(input: {
  question: string;
  messages?: Array<{ role: string; content: string }>;
  context?: any;
  user: AuthUser;
}) {
  const question = str(input.question);
  const mode = detectMode(question);
  const recentCatches = await listUserCatches(input.user, 8).catch(() => []);
  const stats = summarizeCatchStats(recentCatches);

  const system = `You are OceanCore AI, a marine and fishing assistant for a beta app.

Core behavior:
- Be practical, sharp, and useful.
- Keep answers grounded in the provided context.
- Prefer direct tactical guidance over generic fluff.
- If details are missing, say what assumption you are making.
- If the question is about legal limits or regulations, explicitly tell the user to verify with the official local fisheries authority before acting.
- Never pretend conditions are guaranteed safe.

Response style by mode:
- fishing: use headings: Likely Species, Best Window, Where To Look, Technique, Risks, Confidence.
- trip: use headings: Go / No-Go Feel, Launch / Area, Fuel / Access, Conditions, Tactics.
- conditions: summarise wind, swell, and practical boating effect.
- regulations: be cautious and tell them to verify officially.
- general: answer normally but still marine-aware if relevant.`;

  const contextBlock = compactJson(
    {
      mode,
      user: {
        id: input.user.id,
        email: input.user.email,
        is_guest: input.user.isGuest,
      },
      profile: input.context?.profile || null,
      marine: input.context?.marine || null,
      trip: input.context?.trip || null,
      nearby_ramps: input.context?.nearby_ramps || null,
      nearby_fuel: input.context?.nearby_fuel || null,
      recent_catches: recentCatches,
      catch_stats: stats,
    },
    7000
  );

  const history =
    (input.messages || [])
      .slice(-8)
      .map((m) => ({
        role:
          m.role === "assistant" || m.role === "system" ? m.role : "user",
        content: str(m.content),
      }))
      .filter((m) => m.content) || [];

  if (!openai) {
    return {
      success: true,
      mode,
      answer:
        `AI is not configured on the backend yet.\n\n` +
        `Question: ${question}\n\n` +
        `Mode detected: ${mode}\n` +
        `Recent catches loaded: ${recentCatches.length}\n` +
        `Once OPENAI_API_KEY is set, this endpoint will use your catch history, conditions, ramps, fuel, and trip context.`,
    };
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature: 0.5,
    messages: [
      { role: "system", content: system },
      { role: "system", content: `Context:\n${contextBlock}` },
      ...history.map((m) => ({ role: m.role as any, content: m.content })),
      { role: "user", content: question },
    ],
  });

  return {
    success: true,
    mode,
    answer:
      response.choices?.[0]?.message?.content?.trim() ||
      "No answer returned from AI.",
  };
}


async function detectSpeciesFromPhoto(input: { photoDataUrl: string; notes?: string | null }) {
  const notes = str(input.notes || "");
  if (!input.photoDataUrl || !isDataUrlImage(input.photoDataUrl)) {
    throw new Error("A valid image is required for species detection.");
  }

  if (!openai) {
    const noteGuess = notes.toLowerCase();
    let species = "Unknown";
    if (/(tuna|longtail)/i.test(noteGuess)) species = "Longtail tuna";
    else if (/(flathead)/i.test(noteGuess)) species = "Flathead";
    else if (/(snapper)/i.test(noteGuess)) species = "Snapper";
    else if (/(whiting)/i.test(noteGuess)) species = "Whiting";
    return {
      success: true,
      species,
      confidence: species === "Unknown" ? "low" : "medium",
      reasoning: "OpenAI vision is not configured, so this is only a simple fallback guess from notes.",
    };
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a marine species identifier for a fishing app. Identify the most likely fish or marine catch species from the image. Return concise JSON only with keys species, confidence, reasoning. confidence should be one of low, medium, high.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Identify this catch species from the image. Extra notes: ${notes || "none"}. If uncertain, still give the single best guess and a short reason.`,
          },
          {
            type: "image_url",
            image_url: { url: input.photoDataUrl },
          },
        ] as any,
      },
    ],
    response_format: { type: "json_object" } as any,
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    success: true,
    species: cleanSpecies(parsed?.species || "Unknown"),
    confidence: str(parsed?.confidence || "medium"),
    reasoning: str(parsed?.reasoning || "AI image read"),
  };
}

// ============================================================
// Core routes
// ============================================================
app.get("/", async (_req, reply) => {
  ok(reply, {
    success: true,
    name: "OceanCore AI Slim Beta Backend",
    build_id: BUILD_ID,
  });
});

app.get("/health", async (_req, reply) => {
  ok(reply, {
    success: true,
    build_id: BUILD_ID,
    host: HOST,
    port: PORT,
    supabase: !!supabase,
    auth_api_configured: !!(SUPABASE_URL && SUPABASE_AUTH_API_KEY),
    auth_api_key_present: !!SUPABASE_AUTH_API_KEY,
    supabase_url_present: !!SUPABASE_URL,
    openai: !!openai,
    windy_point_forecast_configured: !!WINDY_POINT_FORECAST_KEY,
    catches_table: CATCHES_TABLE,
    profiles_table: PROFILES_TABLE,
    using_profiles_table: !!PROFILES_TABLE,
    has_species_detect_route: true,
    species_detect_paths: [
      "/ai/species-detect",
      "/api/ai/species-detect",
      "/species-detect",
    ],
    species_detect_methods: ["GET", "POST"],
    slim_beta: true,
    kept_features: [
      "auth",
      "profile",
      "legal",
      "catch_log",
      "ai_chat",
      "ramps_and_fuel",
      "windy_weather_and_swell",
      "stats",
      "species_detect",
    ],
    removed_features: [
      "predict",
      "patterns",
      "undersize",
      "boat_ai",
      "fuel_logs",
      "saved_ramps",
      "memory_pages",
      "web_learn",
    ],
  });
});

app.get("/legal/docs", async (_req, reply) => {
  ok(reply, { success: true, ...LEGAL_DOCS });
});

app.get("/legal/terms", async (_req, reply) => {
  ok(reply, { success: true, version: LEGAL_VERSION, text: LEGAL_DOCS.terms });
});

app.get("/legal/privacy", async (_req, reply) => {
  ok(reply, { success: true, version: LEGAL_VERSION, text: LEGAL_DOCS.privacy });
});

app.get("/legal/disclaimer", async (_req, reply) => {
  ok(reply, { success: true, version: LEGAL_VERSION, text: LEGAL_DOCS.disclaimer });
});

app.post("/auth/login", async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const email = str(body.email);
    const password = str(body.password);

    if (!email || !password) {
      reply.code(400).send({ success: false, error: "email and password are required" });
      return;
    }

    const data = await callSupabaseAuth("/token?grant_type=password", { email, password });
    ok(reply, {
      success: true,
      message: "Signed in.",
      session: formatSessionPayload(data),
      user: data.user ?? null,
    });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.post("/auth/refresh", async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const refreshToken = str(body.refresh_token || body.refreshToken);

    if (!refreshToken) {
      reply.code(400).send({ success: false, error: "refresh_token is required" });
      return;
    }

    const data = await callSupabaseAuth("/token?grant_type=refresh_token", { refresh_token: refreshToken });
    ok(reply, {
      success: true,
      message: "Session refreshed.",
      session: formatSessionPayload(data),
      user: data.user ?? null,
    });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.post("/auth/signup", async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const email = str(body.email);
    const password = str(body.password);

    if (!email || !password) {
      reply.code(400).send({ success: false, error: "email and password are required" });
      return;
    }

    const data = await callSupabaseAuth("/signup", { email, password });
    ok(reply, {
      success: true,
      message: data?.access_token
        ? "Account created and signed in."
        : "Account created. Check your email to confirm it before signing in.",
      session: formatSessionPayload(data),
      user: data.user ?? null,
      email_confirmation_required: !data?.access_token,
    });
  } catch (e) {
    fail(reply, e, 400);
  }
});

app.post("/auth/reset-password", async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const email = str(body.email);
    const redirect_to = str(body.redirect_to || body.redirectTo);

    if (!email) {
      reply.code(400).send({ success: false, error: "email is required" });
      return;
    }

    await callSupabaseAuth("/recover", {
      email,
      ...(redirect_to ? { redirect_to } : {}),
    });

    ok(reply, {
      success: true,
      message: "Password reset email sent. Open it on this device/browser to set your password.",
    });
  } catch (e) {
    fail(reply, e, 400);
  }
});

app.post("/auth/magic-link", async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const email = str(body.email);
    const redirect_to = str(body.redirect_to || body.redirectTo);

    if (!email) {
      reply.code(400).send({ success: false, error: "email is required" });
      return;
    }

    await callSupabaseAuth("/otp", {
      email,
      create_user: false,
      ...(redirect_to ? { redirect_to } : {}),
    });

    ok(reply, {
      success: true,
      message: "Magic link sent. Open the email on this device/browser to finish sign-in.",
    });
  } catch (e) {
    fail(reply, e, 400);
  }
});

app.post("/auth/update-password", async (req, reply) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      reply.code(401).send({ success: false, error: "Not signed in. Open the recovery link first." });
      return;
    }

    const body = (req.body || {}) as any;
    const password = str(body.password);
    if (!password || password.length < 6) {
      reply.code(400).send({ success: false, error: "Password must be at least 6 characters." });
      return;
    }

    const data = await callSupabaseUpdateUser(token, { password });
    ok(reply, {
      success: true,
      message: "Password updated. You can now sign in normally.",
      user: data?.user ?? null,
    });
  } catch (e) {
    fail(reply, e, 400);
  }
});

app.post("/auth/logout", async (_req, reply) => {
  ok(reply, { success: true, message: "Signed out." });
});

app.get("/auth/me", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const profile = await getProfileForUser(user);
    ok(reply, {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        is_guest: user.isGuest,
      },
      profile,
      legal: {
        version: profile.legal_version || LEGAL_VERSION,
        terms: !!profile.accepted_terms_at,
        privacy: !!profile.accepted_privacy_at,
        disclaimer: !!profile.accepted_disclaimer_at,
        accepted: !!(
          profile.accepted_terms_at &&
          profile.accepted_privacy_at &&
          profile.accepted_disclaimer_at
        ),
      },
    });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.get("/auth/profile", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const profile = await getProfileForUser(user);
    ok(reply, { success: true, profile });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.patch("/auth/profile", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const body = (req.body || {}) as any;

    const saved = await saveProfileForUser(user, {
      id: user.id,
      email: user.email,
      full_name: str(body.full_name) || null,
      username: str(body.username) || null,
      boat_name: str(body.boat_name) || null,
      home_port: str(body.home_port) || null,
      favourite_species: str(body.favourite_species) || null,
      role_plan: str(body.role_plan) || null,
      avatar_url: str(body.avatar_url) || null,
    });

    ok(reply, { success: true, profile: saved });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.get("/auth/legal-status", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const profile = await getProfileForUser(user);
    ok(reply, {
      success: true,
      version: profile.legal_version || LEGAL_VERSION,
      accepted: !!(
        profile.accepted_terms_at &&
        profile.accepted_privacy_at &&
        profile.accepted_disclaimer_at
      ),
      terms: !!profile.accepted_terms_at,
      privacy: !!profile.accepted_privacy_at,
      disclaimer: !!profile.accepted_disclaimer_at,
    });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.post("/auth/accept-legal", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const body = (req.body || {}) as any;
    const acceptedAt = toIso(body.accepted_at) || new Date().toISOString();

    const current = await getProfileForUser(user);
    const saved = await saveProfileForUser(user, {
      ...current,
      accepted_terms_at: bool(body.terms) ? acceptedAt : current.accepted_terms_at,
      accepted_privacy_at: bool(body.privacy)
        ? acceptedAt
        : current.accepted_privacy_at,
      accepted_disclaimer_at: bool(body.disclaimer)
        ? acceptedAt
        : current.accepted_disclaimer_at,
      legal_version: str(body.version) || LEGAL_VERSION,
    });

    ok(reply, {
      success: true,
      profile: saved,
      accepted: !!(
        saved.accepted_terms_at &&
        saved.accepted_privacy_at &&
        saved.accepted_disclaimer_at
      ),
    });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.get("/catches", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const rows = await listUserCatches(user, clamp(Number((req.query as any)?.limit || 100), 1, 200));
    ok(reply, {
      success: true,
      catches: rows.map((row) => ({
        ...row,
        photo_url: makeAbsoluteMediaUrl(req, row.photo_url),
      })),
    });
  } catch (e) {
    fail(reply, e);
  }
});

app.post("/catches/photo", async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const photoDataUrl = str(body.photo_data_url);
    if (!isDataUrlImage(photoDataUrl)) {
      reply.code(400).send({ success: false, error: "photo_data_url is required" });
      return;
    }
    const photoUrl = await saveDataUrlImage(photoDataUrl);
    ok(reply, {
      success: true,
      photo_url: makeAbsoluteMediaUrl(req, photoUrl),
      relative_photo_url: photoUrl,
    });
  } catch (e) {
    fail(reply, e);
  }
});

app.post("/catches", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const body = (req.body || {}) as any;

    let photoUrl = str(body.photo_url) || null;
    const photoDataUrl = str(body.photo_data_url);

    if (!photoUrl && isDataUrlImage(photoDataUrl)) {
      photoUrl = await saveDataUrlImage(photoDataUrl);
    }

    const saved = await insertCatch(user, {
      species: cleanSpecies(body.species),
      weight_kg: num(body.weight_kg),
      length_cm: num(body.length_cm),
      legal_limit_cm: num(body.legal_limit_cm),
      lat: num(body.lat),
      lng: num(body.lng),
      notes: str(body.notes) || null,
      photo_url: photoUrl,
    });

    ok(reply, {
      success: true,
      catch: {
        ...saved,
        photo_url: makeAbsoluteMediaUrl(req, saved.photo_url),
      },
    });
  } catch (e) {
    fail(reply, e);
  }
});

app.post("/catches/with-photo", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const body = (req.body || {}) as any;

    let photoUrl = str(body.photo_url) || null;
    const photoDataUrl = str(body.photo_data_url);

    if (!photoUrl && isDataUrlImage(photoDataUrl)) {
      photoUrl = await saveDataUrlImage(photoDataUrl);
    }

    const saved = await insertCatch(user, {
      species: cleanSpecies(body.species),
      weight_kg: num(body.weight_kg),
      length_cm: num(body.length_cm),
      legal_limit_cm: num(body.legal_limit_cm),
      lat: num(body.lat),
      lng: num(body.lng),
      notes: str(body.notes) || null,
      photo_url: photoUrl,
    });

    ok(reply, {
      success: true,
      catch: {
        ...saved,
        photo_url: makeAbsoluteMediaUrl(req, saved.photo_url),
      },
    });
  } catch (e) {
    fail(reply, e);
  }
});

app.delete("/catches/:id", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const id = str((req.params as any)?.id);
    if (!id) {
      reply.code(400).send({ success: false, error: "Catch id is required" });
      return;
    }
    const deleted = await deleteCatch(user, id);
    if (!deleted) {
      reply.code(404).send({ success: false, error: "Catch not found" });
      return;
    }
    ok(reply, { success: true, deleted: true });
  } catch (e) {
    fail(reply, e);
  }
});

app.get("/api/stats", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const rows = await listUserCatches(user, 200);
    ok(reply, {
      success: true,
      stats: summarizeCatchStats(rows),
    });
  } catch (e) {
    fail(reply, e);
  }
});

const rampsHandler = async (req: any, reply: any) => {
  try {
    const lat = num(req.query?.lat);
    const lng = num(req.query?.lng);
    const radiusKm = clamp(Number(req.query?.radius_km || 35), 1, 100);

    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }

    let ramps: NearbyPlace[] = [];
    try {
      ramps = await searchNearbyPlaces("ramps", lat, lng, radiusKm);
    } catch (e) {
      console.warn('ramps lookup failed', e);
      ramps = [];
    }
    ok(reply, { success: true, ramps });
  } catch (e) {
    fail(reply, e);
  }
};

const fuelHandler = async (req: any, reply: any) => {
  try {
    const lat = num(req.query?.lat);
    const lng = num(req.query?.lng);
    const radiusKm = clamp(Number(req.query?.radius_km || 35), 1, 100);

    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }

    let fuel: NearbyPlace[] = [];
    try {
      fuel = await searchNearbyPlaces("fuel", lat, lng, radiusKm);
    } catch (e) {
      console.warn('fuel lookup failed', e);
      fuel = [];
    }
    ok(reply, { success: true, fuel });
  } catch (e) {
    fail(reply, e);
  }
};

app.get("/places/ramps", rampsHandler);
app.get("/api/ramps", rampsHandler);
app.get("/ramps", rampsHandler);

app.get("/places/fuel", fuelHandler);
app.get("/api/fuel", fuelHandler);
app.get("/fuel", fuelHandler);

const marineHandler = async (req: any, reply: any) => {
  try {
    const lat = num(req.query?.lat);
    const lng = num(req.query?.lng);

    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }

    const forecast = await getMarineForecast(lat, lng);
    ok(reply, forecast);
  } catch (e) {
    fail(reply, e);
  }
};

app.get("/marine/forecast", marineHandler);
app.get("/api/marine/forecast", marineHandler);
app.get("/weather/marine", marineHandler);
app.get("/api/weather/marine", marineHandler);


const speciesDetectHandler = async (req: any, reply: any) => {
  try {
    const body = (req.body || {}) as any;
    const photoDataUrl = str(body.photo_data_url || body.photoDataUrl || body.image || body.image_data_url);
    const notes = str(body.notes || body.description || "");
    const result = await detectSpeciesFromPhoto({ photoDataUrl, notes });
    ok(reply, result);
  } catch (e) {
    fail(reply, e, 400);
  }
};

const speciesDetectHandshake = async (_req: any, reply: any) => {
  ok(reply, {
    ok: true,
    route: "/ai/species-detect",
    build_id: BUILD_ID,
    has_species_detect_route: true,
    methods: ["GET", "POST"],
  });
};

app.get("/ai/species-detect", speciesDetectHandshake);
app.get("/api/ai/species-detect", speciesDetectHandshake);
app.get("/species-detect", speciesDetectHandshake);
app.post("/ai/species-detect", speciesDetectHandler);
app.post("/api/ai/species-detect", speciesDetectHandler);
app.post("/species-detect", speciesDetectHandler);

app.post("/ai/chat/smart", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const body = (req.body || {}) as any;

    const question =
      str(body.question) ||
      str(body.prompt) ||
      str(body.message);

    if (!question) {
      reply.code(400).send({ success: false, error: "question is required" });
      return;
    }

    const result = await buildSmartReply({
      question,
      messages: Array.isArray(body.messages) ? body.messages : [],
      context: body.context || {},
      user,
    });

    ok(reply, result);
  } catch (e) {
    fail(reply, e);
  }
});

app.get("/ai/chat/smart", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const query = req.query as any;
    const question = str(query.question || query.prompt || query.message);

    if (!question) {
      reply.code(400).send({ success: false, error: "question is required" });
      return;
    }

    const result = await buildSmartReply({
      question,
      context: {},
      user,
    });

    ok(reply, result);
  } catch (e) {
    fail(reply, e);
  }
});

app.get("/__debug/routes", async (_req, reply) => {
  ok(reply, {
    success: true,
    build_id: BUILD_ID,
    routes: [
      "/health",
      "/legal/docs",
      "/auth/login",
      "/auth/signup",
      "/auth/refresh",
      "/auth/logout",
      "/auth/me",
      "/auth/reset-password",
      "/auth/magic-link",
      "/auth/update-password",
      "/auth/profile",
      "/auth/legal-status",
      "/auth/accept-legal",
      "/catches",
      "/catches/photo",
      "/catches/with-photo",
      "/api/stats",
      "/places/ramps",
      "/places/fuel",
      "/marine/forecast",
      "/ai/species-detect",
      "/api/ai/species-detect",
      "/species-detect",
      "/ai/chat/smart",
    ],
  });
});

app.listen({ port: PORT, host: HOST }).then(() => {
  console.log(">>> OceanCore AI SLIM backend loaded <<<");
  console.log("BUILD_ID:", BUILD_ID);
  console.log("HOST:", HOST, "PORT:", PORT);
  console.log("SUPABASE:", !!supabase);
  console.log("OPENAI:", !!openai);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
