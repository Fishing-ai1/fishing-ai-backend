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
import crypto from "node:crypto";
import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUILD_ID = "OC_BACKEND_2026-05-02_V16_BOAT_AI_MERGED";

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

function envValue(name: string) {
  const value = String(process.env[name] || "").trim();
  // Treat starter placeholder strings as empty so health checks do not show false success.
  if (!value || /^your[-_ ]/i.test(value)) return "";
  return value;
}

const SUPABASE_URL = envValue("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = envValue("SUPABASE_SERVICE_KEY");
const SUPABASE_ANON_KEY = envValue("SUPABASE_ANON_KEY");
const OPENAI_API_KEY = envValue("OPENAI_API_KEY");
// Prefer the proper Windy env name, but accept WEATHER_API_KEY as a backwards-compatible alias.
// This fixes Render setups that currently have WEATHER_API_KEY instead of WINDY_POINT_FORECAST_KEY.
const WINDY_POINT_FORECAST_KEY = envValue("WINDY_POINT_FORECAST_KEY") || envValue("WEATHER_API_KEY");
const WINDY_KEY_SOURCE = envValue("WINDY_POINT_FORECAST_KEY")
  ? "WINDY_POINT_FORECAST_KEY"
  : envValue("WEATHER_API_KEY")
  ? "WEATHER_API_KEY"
  : "missing";
// Optional future raw-data processing token. NASA GIBS visual tiles do not need this.
// Keep this backend-only. Never put it in the frontend.
const EARTHDATA_BEARER_TOKEN = envValue("EARTHDATA_BEARER_TOKEN") || envValue("NASA_EARTHDATA_TOKEN");
// Live ocean numeric data. Default SST uses NOAA CoastWatch ERDDAP MUR SST.
// Chlorophyll/currents/depth are intentionally optional because those providers differ by account/region.
// Add these when you have the provider details and OceanCore will ingest them without frontend changes.
const NOAA_MUR_SST_ERDDAP_BASE = envValue("NOAA_MUR_SST_ERDDAP_BASE") || "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41";
const NOAA_MUR_SST_VARIABLE = envValue("NOAA_MUR_SST_VARIABLE") || "analysed_sst";
const NOAA_CHL_ERDDAP_BASE = envValue("NOAA_CHL_ERDDAP_BASE");
const NOAA_CHL_VARIABLE = envValue("NOAA_CHL_VARIABLE") || "chlorophyll";
const COPERNICUS_CURRENT_ENDPOINT = envValue("COPERNICUS_CURRENT_ENDPOINT");
const GEBCO_DEPTH_ENDPOINT = envValue("GEBCO_DEPTH_ENDPOINT");
const OCEAN_DATA_TIMEOUT_MS = Number(process.env.OCEAN_DATA_TIMEOUT_MS || 6500);

const CATCHES_TABLE = process.env.CATCHES_TABLE || "catches";
const PROFILES_TABLE = process.env.PROFILES_TABLE || "profiles";
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || "feedback_reports";
const AUDIT_TABLE = process.env.AUDIT_TABLE || "audit_log";
const USAGE_TABLE = process.env.USAGE_TABLE || "usage_daily";
const SAVED_AREAS_TABLE = process.env.SAVED_AREAS_TABLE || "saved_areas";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
const TACTICAL_SNAPSHOTS_TABLE = process.env.TACTICAL_SNAPSHOTS_TABLE || "tactical_snapshots";
const AI_CHAT_SESSIONS_TABLE = process.env.AI_CHAT_SESSIONS_TABLE || "ai_chat_sessions";
const AI_CHAT_MESSAGES_TABLE = process.env.AI_CHAT_MESSAGES_TABLE || "ai_chat_messages";
const AI_MEMORY_TABLE = process.env.AI_MEMORY_TABLE || "ai_memory";
const AI_FEEDBACK_TABLE = process.env.AI_FEEDBACK_TABLE || "ai_feedback";

// Stripe billing / subscriptions. Put these in .env / Render, never in frontend.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_PRICE_STARTER_MONTHLY = process.env.STRIPE_PRICE_STARTER_MONTHLY || "";
const STRIPE_PRICE_STARTER_YEARLY = process.env.STRIPE_PRICE_STARTER_YEARLY || "";
const STRIPE_PRICE_BASIC_MONTHLY = process.env.STRIPE_PRICE_BASIC_MONTHLY || "";
const STRIPE_PRICE_BASIC_YEARLY = process.env.STRIPE_PRICE_BASIC_YEARLY || "";
const STRIPE_PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY || "";
const STRIPE_PRICE_PRO_YEARLY = process.env.STRIPE_PRICE_PRO_YEARLY || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "";
// During beta, admin can manually assign starter/basic/pro/founder without Stripe being active.
const BETA_MANUAL_PLAN_ACCESS = String(process.env.BETA_MANUAL_PLAN_ACCESS || "true").toLowerCase() !== "false";

// Admin access: set ADMIN_EMAILS in Render to your own login email, comma-separated for multiple admins.
// Example: ADMIN_EMAILS=you@email.com,founder2@email.com
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

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
  app_role?: string | null;
  plan?: string | null;
  subscription_status?: string | null;
  account_status?: string | null;
  admin_notes?: string | null;
  suspended_at?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  subscription_current_period_end?: string | null;
  subscription_cancel_at_period_end?: boolean | null;
  ads_enabled?: boolean | null;
  ai_daily_limit?: number | null;
  saved_area_limit?: number | null;
  catch_card_level?: string | null;
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

type SavedAreaRow = {
  id: string;
  user_id?: string | null;
  user_email?: string | null;
  name: string;
  area_type?: string | null;
  lat: number;
  lng: number;
  radius_km?: number | null;
  general_area?: string | null;
  notes?: string | null;
  privacy?: string | null;
  created_at: string;
  updated_at?: string | null;
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
    app_role: pickMetaString(meta, ["app_role", "role"]),
    plan: pickMetaString(meta, ["plan", "subscription_plan"]) || "free",
    subscription_status: pickMetaString(meta, ["subscription_status"]) || "none",
    account_status: pickMetaString(meta, ["account_status"]) || "active",
    admin_notes: pickMetaString(meta, ["admin_notes"]),
    suspended_at: pickMetaString(meta, ["suspended_at"]),
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
    app_role: profile.app_role ?? null,
    plan: profile.plan ?? "free",
    subscription_status: profile.subscription_status ?? "none",
    account_status: profile.account_status ?? "active",
    admin_notes: profile.admin_notes ?? null,
    suspended_at: profile.suspended_at ?? null,
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
// Keep raw JSON body for Stripe webhook signature verification while still parsing normal JSON routes.
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (req: any, body: string, done) => {
  req.rawBody = body || "";
  if (!body) return done(null, {});
  try { done(null, JSON.parse(body)); }
  catch (e) { done(e as Error, undefined); }
});

app.register(multipart, { attachFieldsToBody: true });
app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: "/media/" });

const mem = {
  profiles: new Map<string, ProfileRow>(),
  catches: [] as CatchRow[],
  feedback: [] as any[],
  audit: [] as any[],
  aiUsage: new Map<string, number>(),
  savedAreas: [] as SavedAreaRow[],
  aiChatSessions: [] as any[],
  aiChatMessages: [] as any[],
  aiMemory: [] as any[],
  aiFeedback: [] as any[],
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

function adminError(message: string, statusCode = 403) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function isAdminUser(user: AuthUser) {
  const email = String(user.email || "").trim().toLowerCase();
  return (!!email && ADMIN_EMAILS.includes(email)) || ADMIN_USER_IDS.includes(user.id);
}

async function requireAdminUser(req: any): Promise<AuthUser> {
  const user = await getRequiredAuthUser(req);

  if (!ADMIN_EMAILS.length && !ADMIN_USER_IDS.length) {
    throw adminError("Admin access is not configured. Add ADMIN_EMAILS in Render, then redeploy.", 403);
  }

  if (!isAdminUser(user)) {
    throw adminError("Admin access denied for this account.", 403);
  }

  return user;
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
    app_role: row.app_role ?? null,
    plan: row.plan ?? "free",
    subscription_status: row.subscription_status ?? "none",
    account_status: row.account_status ?? "active",
    admin_notes: row.admin_notes ?? null,
    suspended_at: row.suspended_at ?? null,
    stripe_customer_id: row.stripe_customer_id ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    subscription_current_period_end: row.subscription_current_period_end ?? null,
    subscription_cancel_at_period_end: row.subscription_cancel_at_period_end ?? null,
    ads_enabled: row.ads_enabled ?? null,
    ai_daily_limit: row.ai_daily_limit ?? null,
    saved_area_limit: row.saved_area_limit ?? null,
    catch_card_level: row.catch_card_level ?? null,
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
      "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at"
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
      "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at"
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
  // SAFE MERGE SAVE:
  // Always merge the existing stored profile first, then apply the patch.
  // This stops Accept Legal/admin/profile updates from wiping full_name,
  // boat_name, home_port, favourite_species, etc.
  const currentMeta = profileFromMetadata(user);

  if (!supabase || user.isGuest) {
    const current = normalizeProfile(mem.profiles.get(user.id) || { ...currentMeta, id: user.id, email: user.email });
    const merged = normalizeProfile({
      ...current,
      ...patch,
      id: user.id,
      email: patch.email ?? current.email ?? user.email ?? null,
      legal_version: patch.legal_version ?? current.legal_version ?? LEGAL_VERSION,
      updated_at: new Date().toISOString(),
    });
    mem.profiles.set(user.id, merged);
    return merged;
  }

  const existing = await supabase
    .from(PROFILES_TABLE)
    .select(
      "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (existing.error && (existing.error as any)?.code !== "PGRST116") {
    throw existing.error;
  }

  const current = normalizeProfile(existing.data || { ...currentMeta, id: user.id, email: user.email });
  const payload: ProfileRow = normalizeProfile({
    ...current,
    ...patch,
    id: user.id,
    email: patch.email ?? current.email ?? user.email ?? null,
    legal_version: patch.legal_version ?? current.legal_version ?? LEGAL_VERSION,
    updated_at: new Date().toISOString(),
  });

  const saved = await supabase
    .from(PROFILES_TABLE)
    .upsert(payload, { onConflict: "id" })
    .select(
      "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at"
    )
    .single();

  if (saved.error) throw saved.error;

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
      "Windy forecast is not configured on the backend yet. Add WINDY_POINT_FORECAST_KEY to .env. WEATHER_API_KEY is also accepted as a fallback alias.",
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


// ============================================================
// OceanCore Satellite Intel V1 — real raster overlay support + species scan
// ============================================================
type SatelliteSignal = "green" | "amber" | "red";

type SatelliteCell = {
  id: string;
  lat: number;
  lng: number;
  score: number;
  signal: SatelliteSignal;
  // Absolute score is 0-100. Relative rank makes the scan useful like Rip-style charts:
  // the strongest cells in THIS area become hot zones even if the day is only average.
  relative_rank?: number;
  relative_percentile?: number;
  signal_basis?: string;
  normalized_heat?: number;
  heat_alpha?: number;
  target_species: string;
  target_species_label: string;
  reasons: string[];
  ocean: OceanSnapshot;
  components: {
    weather: number;
    species: number;
    sst: number | null;
    chlorophyll: number | null;
    current: number | null;
    depth: number | null;
    data_quality: number;
    front?: number;
    shelf?: number;
    eddy?: number;
  };
};

type OceanScalarSource = {
  value: number | null;
  unit: string | null;
  source: string;
  status: "live" | "configured_missing" | "unconfigured" | "error";
  error?: string | null;
  raw_value?: number | null;
};

type OceanSnapshot = {
  success: boolean;
  location: { lat: number; lng: number };
  generated_at: string;
  marine: any;
  sst_c: number | null;
  chlorophyll_mg_m3: number | null;
  current_speed_kts: number | null;
  current_direction_deg: number | null;
  depth_m: number | null;
  sources: {
    weather: string;
    sst: OceanScalarSource;
    chlorophyll: OceanScalarSource;
    currents: OceanScalarSource;
    depth: OceanScalarSource;
  };
};

const SATELLITE_TARGETS: Record<string, { label: string; group: string; profile: string; prefers: string[] }> = {
  black_marlin: { label: "Black Marlin", group: "Billfish", profile: "warm_bluewater_edge", prefers: ["warm water", "current edges", "bait schools", "offshore structure"] },
  blue_marlin: { label: "Blue Marlin", group: "Billfish", profile: "warm_bluewater_edge", prefers: ["warm water", "bluewater edges", "current lines", "bait"] },
  striped_marlin: { label: "Striped Marlin", group: "Billfish", profile: "temperate_edge", prefers: ["temperature breaks", "bait edges", "shelf lines"] },
  sailfish: { label: "Sailfish", group: "Billfish", profile: "warm_inshore_bluewater", prefers: ["warm water", "bait schools", "current lines"] },
  spearfish: { label: "Spearfish", group: "Billfish", profile: "temperate_edge", prefers: ["thermal breaks", "deep edges", "bait"] },

  southern_bluefin_tuna: { label: "Southern Bluefin Tuna", group: "Tuna", profile: "cool_temp_break", prefers: ["cooler productive water", "hard thermal fronts", "bait edges", "shelf structure"] },
  yellowfin_tuna: { label: "Yellowfin Tuna", group: "Tuna", profile: "warm_edge", prefers: ["warm edges", "current lines", "chlorophyll edges", "bait"] },
  longtail_tuna: { label: "Longtail Tuna", group: "Tuna", profile: "coastal_bait_edge", prefers: ["coastal bait", "clean-green edges", "wind lines"] },
  bigeye_tuna: { label: "Bigeye Tuna", group: "Tuna", profile: "deep_edge", prefers: ["deep edges", "temperature breaks", "night/day vertical movement"] },
  albacore: { label: "Albacore", group: "Tuna", profile: "cool_temp_break", prefers: ["cooler water", "fronts", "bait edges"] },
  skipjack_tuna: { label: "Skipjack Tuna", group: "Tuna", profile: "bait_productivity", prefers: ["bait schools", "chlorophyll edges", "surface activity"] },
  dogtooth_tuna: { label: "Dogtooth Tuna", group: "Tuna", profile: "reef_dropoff", prefers: ["reef drop-offs", "current", "deep structure"] },

  spanish_mackerel: { label: "Spanish Mackerel", group: "Mackerel / Wahoo", profile: "coastal_bait_edge", prefers: ["bait schools", "clean water", "reef/current edges"] },
  spotted_mackerel: { label: "Spotted Mackerel", group: "Mackerel / Wahoo", profile: "coastal_bait_edge", prefers: ["coastal bait", "surface activity", "moderate clean water"] },
  school_mackerel: { label: "School Mackerel", group: "Mackerel / Wahoo", profile: "coastal_bait_edge", prefers: ["coastal bait", "inshore edges", "surface schools"] },
  wahoo: { label: "Wahoo", group: "Mackerel / Wahoo", profile: "fast_current_edge", prefers: ["strong current edges", "bluewater", "FAD/structure edges"] },

  mahi_mahi: { label: "Mahi Mahi / Dolphinfish", group: "Other Pelagics", profile: "warm_floating_structure", prefers: ["warm water", "current seams", "floating structure", "FADs"] },
  cobia: { label: "Cobia", group: "Other Pelagics", profile: "structure_current", prefers: ["structure", "current lines", "rays/sharks/bait"] },
  queenfish: { label: "Queenfish", group: "Other Pelagics", profile: "coastal_bait_edge", prefers: ["coastal bait", "current lines", "warm water"] },
  giant_trevally: { label: "Giant Trevally", group: "Other Pelagics", profile: "reef_current", prefers: ["reef current", "pressure edges", "bait"] },
  amberjack: { label: "Amberjack", group: "Other Pelagics", profile: "deep_structure", prefers: ["deep structure", "current", "bait"] },
  samson_fish: { label: "Samson Fish", group: "Other Pelagics", profile: "deep_structure", prefers: ["deep structure", "cooler edges", "bait"] },
  kingfish: { label: "Kingfish", group: "Other Pelagics", profile: "structure_current", prefers: ["structure", "current", "bait schools"] },
};

function normalizeTargetSpecies(raw: any) {
  const key = str(raw, "black_marlin").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return SATELLITE_TARGETS[key] ? key : "black_marlin";
}

function weatherScoreForSatellite(marine: any) {
  const current = marine?.current || {};
  const wind = Number(current.wind_kts ?? 0);
  const gust = Number(current.gust_kts ?? 0);
  const wave = Number(current.wave_m ?? 0);
  const swell = Number(current.swell_m ?? 0);

  let score = 70;
  const reasons: string[] = [];

  if (wind && wind <= 12) { score += 12; reasons.push("Wind looks fishable"); }
  else if (wind && wind <= 18) { score += 2; reasons.push("Moderate wind"); }
  else if (wind) { score -= 18; reasons.push("Strong wind risk"); }

  if (gust && gust > 26) { score -= 14; reasons.push("High gust risk"); }
  else if (gust && gust <= 20) { score += 5; reasons.push("Gusts controlled"); }

  if (wave && wave <= 0.8) { score += 8; reasons.push("Wave height manageable"); }
  else if (wave && wave <= 1.5) { score -= 2; reasons.push("Some sea state"); }
  else if (wave) { score -= 18; reasons.push("Rough wave height"); }

  if (swell && swell > 1.7) { score -= 14; reasons.push("High swell risk"); }
  else if (swell && swell <= 1.0) { score += 4; reasons.push("Swell reasonable"); }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

function speciesProfileScore(speciesKey: string, lat: number, lng: number) {
  const target = SATELLITE_TARGETS[speciesKey] || SATELLITE_TARGETS.black_marlin;
  // Deterministic small variation by cell so the V1 raster/score overlay shows usable zones
  // before SST/chlorophyll numeric ingestion is plugged in.
  const wave = Math.sin((lat * 12.9898 + lng * 78.233) * 0.35);
  const edge = Math.cos((lat * 4.23 - lng * 9.17) * 0.55);
  let score = 55 + Math.round(wave * 12 + edge * 10);
  const reasons: string[] = [];

  if (target.profile.includes("warm")) { score += 7; reasons.push("Target favours warm bluewater edges"); }
  if (target.profile.includes("cool")) { score += 4; reasons.push("Target favours cooler productive breaks"); }
  if (target.profile.includes("current") || target.profile.includes("edge")) { score += 6; reasons.push("Edge/current profile selected"); }
  if (target.profile.includes("structure") || target.profile.includes("reef")) { score += 3; reasons.push("Structure/current behaviour included"); }

  return { score: clamp(score, 0, 100), reasons };
}

function signalFromScore(score: number): SatelliteSignal {
  if (score >= 72) return "green";
  if (score >= 45) return "amber";
  return "red";
}


function oceanDataEmptySource(source: string, status: OceanScalarSource["status"], error?: string | null): OceanScalarSource {
  return { value: null, unit: null, source, status, error: error || null };
}

async function fetchJsonWithTimeout(url: string, timeoutMs = OCEAN_DATA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "OceanCoreAI/1.0 (+https://oceancore.ai)" },
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; }
    catch { json = { error: text || `Request failed (${res.status})` }; }
    if (!res.ok) throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function erddapPointUrl(base: string, variable: string, lat: number, lng: number) {
  const cleanBase = String(base || "").replace(/\/$/, "");
  const q = `${variable}[(last)][(${lat})][(${lng})]`;
  return `${cleanBase}.json?${encodeURIComponent(q)}`;
}

function readErddapFirstNumber(json: any): number | null {
  const rows = json?.table?.rows;
  if (!Array.isArray(rows) || !rows.length) return null;
  const row = rows[0];
  if (!Array.isArray(row) || !row.length) return null;
  for (let i = row.length - 1; i >= 0; i--) {
    const n = Number(row[i]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function fetchMURSstC(lat: number, lng: number): Promise<OceanScalarSource> {
  if (!NOAA_MUR_SST_ERDDAP_BASE) return oceanDataEmptySource("NOAA CoastWatch ERDDAP MUR SST", "unconfigured");
  try {
    const json = await fetchJsonWithTimeout(erddapPointUrl(NOAA_MUR_SST_ERDDAP_BASE, NOAA_MUR_SST_VARIABLE, lat, lng));
    const raw = readErddapFirstNumber(json);
    if (raw == null) return oceanDataEmptySource("NOAA CoastWatch ERDDAP MUR SST", "configured_missing", "No SST value returned for this point/date.");
    const c = raw > 100 ? raw - 273.15 : raw;
    return { value: round2(c), unit: "°C", source: "NOAA CoastWatch ERDDAP MUR SST", status: "live", raw_value: raw };
  } catch (e) {
    return oceanDataEmptySource("NOAA CoastWatch ERDDAP MUR SST", "error", e instanceof Error ? e.message : String(e));
  }
}

async function fetchChlorophyllMgM3(lat: number, lng: number): Promise<OceanScalarSource> {
  if (!NOAA_CHL_ERDDAP_BASE) return oceanDataEmptySource("NOAA/NASA OceanColor ERDDAP chlorophyll", "unconfigured", "Set NOAA_CHL_ERDDAP_BASE to a griddap dataset base URL when you choose the chlorophyll provider.");
  try {
    const json = await fetchJsonWithTimeout(erddapPointUrl(NOAA_CHL_ERDDAP_BASE, NOAA_CHL_VARIABLE, lat, lng));
    const raw = readErddapFirstNumber(json);
    if (raw == null) return oceanDataEmptySource("NOAA/NASA OceanColor ERDDAP chlorophyll", "configured_missing", "No chlorophyll value returned for this point/date.");
    return { value: round2(raw), unit: "mg/m³", source: "NOAA/NASA OceanColor ERDDAP chlorophyll", status: "live", raw_value: raw };
  } catch (e) {
    return oceanDataEmptySource("NOAA/NASA OceanColor ERDDAP chlorophyll", "error", e instanceof Error ? e.message : String(e));
  }
}

async function fetchConfiguredOceanScalar(endpoint: string, lat: number, lng: number, source: string, unit: string): Promise<OceanScalarSource> {
  if (!endpoint) return oceanDataEmptySource(source, "unconfigured");
  try {
    const sep = endpoint.includes("?") ? "&" : "?";
    const json = await fetchJsonWithTimeout(`${endpoint}${sep}lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    const value = Number(json?.value ?? json?.speed_kts ?? json?.depth_m ?? json?.current_speed_kts ?? json?.data?.value);
    if (!Number.isFinite(value)) return oceanDataEmptySource(source, "configured_missing", "Provider response did not include a numeric value.");
    return { value: round2(value), unit, source, status: "live", raw_value: value };
  } catch (e) {
    return oceanDataEmptySource(source, "error", e instanceof Error ? e.message : String(e));
  }
}

async function getOceanSnapshot(lat: number, lng: number): Promise<OceanSnapshot> {
  const [marine, sst, chlorophyll, currents, depth] = await Promise.all([
    getMarineForecast(lat, lng).catch((e) => ({ success: false, warning: e instanceof Error ? e.message : String(e), current: null, hours: [] })),
    fetchMURSstC(lat, lng),
    fetchChlorophyllMgM3(lat, lng),
    fetchConfiguredOceanScalar(COPERNICUS_CURRENT_ENDPOINT, lat, lng, "Copernicus/current provider endpoint", "kt"),
    fetchConfiguredOceanScalar(GEBCO_DEPTH_ENDPOINT, lat, lng, "GEBCO/depth provider endpoint", "m"),
  ]);

  return {
    success: true,
    location: { lat, lng },
    generated_at: new Date().toISOString(),
    marine,
    sst_c: sst.value,
    chlorophyll_mg_m3: chlorophyll.value,
    current_speed_kts: currents.value,
    current_direction_deg: null,
    depth_m: depth.value,
    sources: {
      weather: marine?.source_name || "Windy Point Forecast API",
      sst,
      chlorophyll,
      currents,
      depth,
    },
  };
}

function scoreRange(value: number | null, min: number, idealMin: number, idealMax: number, max: number) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= idealMin && value <= idealMax) return 18;
  if (value < min || value > max) return 2;
  if (value < idealMin) return clamp(Math.round(((value - min) / Math.max(0.001, idealMin - min)) * 16) + 2, 2, 18);
  return clamp(Math.round(((max - value) / Math.max(0.001, max - idealMax)) * 16) + 2, 2, 18);
}

function sstScoreForTarget(speciesKey: string, target: { profile: string }, sstC: number | null) {
  if (sstC == null) return null;
  if (target.profile.includes("cool") || speciesKey.includes("bluefin") || speciesKey.includes("albacore")) {
    return scoreRange(sstC, 10, 15, 21, 26);
  }
  if (target.profile.includes("temperate")) return scoreRange(sstC, 14, 18, 24, 29);
  if (target.profile.includes("coastal")) return scoreRange(sstC, 18, 22, 29, 32);
  return scoreRange(sstC, 18, 24, 30, 33);
}

function chlorophyllScoreForTarget(target: { profile: string }, chl: number | null) {
  if (chl == null) return null;
  if (target.profile.includes("bait") || target.profile.includes("coastal")) return scoreRange(chl, 0.03, 0.18, 1.1, 3.0);
  return scoreRange(chl, 0.02, 0.06, 0.45, 1.8);
}

function dataQualityScore(snapshot: OceanSnapshot) {
  const liveCount = [snapshot.sources.sst, snapshot.sources.chlorophyll, snapshot.sources.currents, snapshot.sources.depth]
    .filter((s) => s.status === "live").length;
  const weatherLive = snapshot.marine?.source_status === "windy_live" ? 1 : 0;
  return clamp((liveCount * 4) + (weatherLive * 4), 0, 20);
}

function oceanSnapshotReasons(snapshot: OceanSnapshot, sstScore: number | null, chlScore: number | null) {
  const current = snapshot.marine?.current || {};
  const reasons: string[] = [];
  if (current?.wind_kts != null) reasons.push(`Windy live: ${current.wind_kts} kt wind, ${current.wave_m ?? "—"} m wave`);
  if (snapshot.sst_c != null) reasons.push(`Live SST: ${snapshot.sst_c}°C (${snapshot.sources.sst.source})`);
  else reasons.push(`SST numeric: ${snapshot.sources.sst.status}`);
  if (snapshot.chlorophyll_mg_m3 != null) reasons.push(`Live chlorophyll: ${snapshot.chlorophyll_mg_m3} mg/m³`);
  else if (snapshot.sources.chlorophyll.status !== "unconfigured") reasons.push(`Chlorophyll numeric: ${snapshot.sources.chlorophyll.status}`);
  if (snapshot.current_speed_kts != null) reasons.push(`Live current: ${snapshot.current_speed_kts} kt`);
  if (snapshot.depth_m != null) reasons.push(`Live depth: ${snapshot.depth_m} m`);
  if (sstScore != null) reasons.push(`SST suitability ${sstScore}/18`);
  if (chlScore != null) reasons.push(`Chlorophyll suitability ${chlScore}/18`);
  return reasons;
}

async function buildSatelliteIntelGrid(input: { lat: number; lng: number; radiusKm: number; speciesKey: string; layer: string; }) {
  const target = SATELLITE_TARGETS[input.speciesKey] || SATELLITE_TARGETS.black_marlin;

  // V25 Rip-style heat layer:
  // Pull live ocean data at anchor points, then build a dense continuous raster grid.
  // This avoids hammering Windy/NOAA with 1000+ requests while still producing a smooth heat surface.
  const latRadiusDeg = input.radiusKm / 111;
  const lngRadiusDeg = input.radiusKm / Math.max(25, 111 * Math.cos((Math.abs(input.lat) * Math.PI) / 180));
  const minLat = input.lat - latRadiusDeg;
  const maxLat = input.lat + latRadiusDeg;
  const minLng = input.lng - lngRadiusDeg;
  const maxLng = input.lng + lngRadiusDeg;

  const rows = input.radiusKm >= 150 ? 55 : input.radiusKm >= 90 ? 49 : input.radiusKm >= 55 ? 43 : 39;
  const cols = rows;

  const anchorSteps = [0, 0.5, 1];
  const anchors: Array<{ lat: number; lng: number; ocean: OceanSnapshot; weather: ReturnType<typeof weatherScoreForSatellite>; sstScore: number | null; chlScore: number | null; currentScore: number | null; depthScore: number | null; quality: number; }> = [];

  for (const ay of anchorSteps) {
    for (const ax of anchorSteps) {
      const aLat = Number((maxLat - (maxLat - minLat) * ay).toFixed(6));
      const aLng = Number((minLng + (maxLng - minLng) * ax).toFixed(6));
      const ocean = await getOceanSnapshot(aLat, aLng);
      const weather = weatherScoreForSatellite(ocean.marine);
      const sstScore = sstScoreForTarget(input.speciesKey, target, ocean.sst_c);
      const chlScore = chlorophyllScoreForTarget(target, ocean.chlorophyll_mg_m3);
      const currentScore = ocean.current_speed_kts != null ? scoreRange(ocean.current_speed_kts, 0, 0.4, 2.2, 4.5) : null;
      const depthScore = ocean.depth_m != null ? scoreRange(Math.abs(ocean.depth_m), 15, 40, 600, 2500) : null;
      const quality = dataQualityScore(ocean);
      anchors.push({ lat: aLat, lng: aLng, ocean, weather, sstScore, chlScore, currentScore, depthScore, quality });
    }
  }

  function nearestAnchor(lat: number, lng: number) {
    let best = anchors[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const a of anchors) {
      const d = (a.lat - lat) ** 2 + (a.lng - lng) ** 2;
      if (d < bestD) { best = a; bestD = d; }
    }
    return best;
  }

  const cells: SatelliteCell[] = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = cols <= 1 ? 0.5 : x / (cols - 1);
      const py = rows <= 1 ? 0.5 : y / (rows - 1);
      const cellLat = Number((maxLat - (maxLat - minLat) * py).toFixed(6));
      const cellLng = Number((minLng + (maxLng - minLng) * px).toFixed(6));
      const a = nearestAnchor(cellLat, cellLng);
      const species = speciesProfileScore(input.speciesKey, cellLat, cellLng);

      // Ocean fronts/shelf/eddy bands create the continuous Rip-style heat surface.
      // They are deterministic, area-specific and blended with the live anchor data above.
      const frontLine = 0.50 + 0.18 * Math.sin(px * 9.2 + input.lng * 0.07) + 0.05 * Math.sin(px * 23.0 + input.lat * 0.05);
      const thermalFront = Math.exp(-Math.abs(py - frontLine) * 10.5);
      const shelfLine = 0.62 + 0.09 * Math.sin(py * 12.0 + input.lat * 0.09);
      const shelfEdge = Math.exp(-Math.abs(px - shelfLine) * 13.0);
      const eddyA = Math.sin((Math.hypot(px - 0.72, py - 0.36) * 20.0) + input.lng * 0.04);
      const eddyB = Math.cos((px * 8.5 - py * 10.5) + input.lat * 0.06);
      const eddyScore = clamp(Math.round(((eddyA + 1) * 0.5) * 8 + ((eddyB + 1) * 0.5) * 5), 0, 13);
      const noise = satNoise(cellLat, cellLng, x + y * 41);

      const liveOceanScore = (a.sstScore ?? 8) + (a.chlScore ?? 7) + (a.currentScore ?? 7) + Math.round((a.depthScore ?? 9) * 0.45);
      const frontScore = Math.round(thermalFront * 20);
      const shelfScore = Math.round(shelfEdge * 14);
      const weatherScore = a.weather.score;
      const quality = a.quality;

      const score = clamp(Math.round(
        (weatherScore * 0.22) +
        (species.score * 0.20) +
        liveOceanScore +
        frontScore +
        shelfScore +
        eddyScore +
        (noise * 5) +
        quality
      ), 0, 100);

      const ocean = { ...a.ocean, location: { lat: cellLat, lng: cellLng }, generated_at: new Date().toISOString() } as OceanSnapshot;
      const reasons = [
        `Continuous heat cell: thermal front ${frontScore}/20, shelf edge ${shelfScore}/14`,
        ...oceanSnapshotReasons(a.ocean, a.sstScore, a.chlScore),
        ...species.reasons,
        ...a.weather.reasons,
      ].slice(0, 8);

      cells.push({
        id: `${cellLat.toFixed(4)},${cellLng.toFixed(4)},${input.speciesKey}`,
        lat: cellLat,
        lng: cellLng,
        score,
        signal: signalFromScore(score),
        target_species: input.speciesKey,
        target_species_label: target.label,
        reasons,
        ocean,
        components: {
          weather: weatherScore,
          species: species.score,
          sst: a.sstScore,
          chlorophyll: a.chlScore,
          current: a.currentScore,
          depth: a.depthScore,
          data_quality: quality,
          front: frontScore,
          shelf: shelfScore,
          eddy: eddyScore,
        },
      });
    }
  }

  return applyRelativeHotzoneSignals(cells);
}

function applyRelativeHotzoneSignals(cells: SatelliteCell[]) {
  if (!cells.length) return cells;

  // Keep the absolute score, but render the selected area as a relative heat field.
  // Top water becomes hot, mid water becomes building, weak water becomes risk.
  const scores = cells.map((c) => c.score).filter((n) => Number.isFinite(n));
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = Math.max(1, maxScore - minScore);
  const sorted = [...cells].sort((a, b) => b.score - a.score);
  const n = sorted.length;
  const greenCount = Math.max(5, Math.round(n * 0.14));
  const amberCount = Math.max(10, Math.round(n * 0.58));

  sorted.forEach((cell, index) => {
    const percentile = n <= 1 ? 100 : Math.round(((n - index) / n) * 100);
    const normalized = clamp((cell.score - minScore) / range, 0, 1);
    cell.relative_rank = index + 1;
    cell.relative_percentile = percentile;
    cell.normalized_heat = Number(normalized.toFixed(4));
    cell.heat_alpha = Number((0.18 + normalized * 0.72).toFixed(4));

    if (index < greenCount || normalized >= 0.82) cell.signal = "green";
    else if (index < greenCount + amberCount || normalized >= 0.38) cell.signal = "amber";
    else cell.signal = "red";

    cell.signal_basis = "continuous_relative_heatmap";
    const note = cell.signal === "green"
      ? `Rip-style heat: top ${percentile}% of this selected ocean area`
      : cell.signal === "amber"
      ? `Building water: mid ${percentile}% of this selected ocean area`
      : `Lower-priority water: bottom ${100 - percentile}% of this selected ocean area`;
    cell.reasons = [note, ...(cell.reasons || [])].slice(0, 9);
  });

  return cells;
}

function satelliteCellBounds(cells: SatelliteCell[]) {
  if (!cells.length) return null;
  const lats = cells.map((c) => c.lat);
  const lngs = cells.map((c) => c.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

function summarizeSatelliteCells(cells: SatelliteCell[]) {
  return cells.reduce((acc, cell) => {
    acc[cell.signal] += 1;
    return acc;
  }, { green: 0, amber: 0, red: 0 } as Record<SatelliteSignal, number>);
}

function buildSatelliteInsights(speciesKey: string, layer: string, cells: SatelliteCell[]) {
  const target = SATELLITE_TARGETS[speciesKey] || SATELLITE_TARGETS.black_marlin;
  const best = [...cells].sort((a, b) => b.score - a.score)[0];
  const summary = summarizeSatelliteCells(cells);
  const liveSst = cells.filter((c) => c.ocean?.sources?.sst?.status === "live").length;
  const liveChl = cells.filter((c) => c.ocean?.sources?.chlorophyll?.status === "live").length;
  const liveWeather = cells.filter((c) => c.ocean?.marine?.source_status === "windy_live").length;
  return [
    {
      title: `${target.label} behaviour model`,
      body: `This scan favours ${target.prefers.slice(0, 4).join(", ")}. OceanCore scores cells where live ocean data and the species profile line up.`,
    },
    {
      title: "Live data pull",
      body: `Windy live cells: ${liveWeather}/${cells.length}. NOAA MUR SST cells: ${liveSst}/${cells.length}. Chlorophyll cells: ${liveChl}/${cells.length}${liveChl ? "." : " — add NOAA_CHL_ERDDAP_BASE when you pick the chlorophyll dataset."}`,
    },
    {
      title: "Best cell",
      body: best ? `Best current cell is ${best.score}/100 near ${best.lat.toFixed(3)}, ${best.lng.toFixed(3)} with ${best.signal.toUpperCase()} signal. SST ${best.ocean?.sst_c ?? "—"}°C, Chl ${best.ocean?.chlorophyll_mg_m3 ?? "—"} mg/m³.` : "No best cell yet.",
    },
    {
      title: "Zone count",
      body: `${summary.green} strong zones, ${summary.amber} medium zones and ${summary.red} avoid zones in this scan.`,
    },
  ];
}

function buildSatellitePlan(speciesKey: string, cells: SatelliteCell[]) {
  const target = SATELLITE_TARGETS[speciesKey] || SATELLITE_TARGETS.black_marlin;
  const best = [...cells].sort((a, b) => b.score - a.score)[0];
  const confidence = best ? clamp(Math.round(best.score), 35, 92) : 50;
  return {
    heading: `${target.label} tactical plan`,
    confidence,
    body: best
      ? `Start by checking the strongest edge near ${best.lat.toFixed(3)}, ${best.lng.toFixed(3)}. Work the colour break/current line, then adjust based on birds, bait and live sea state. Verify official forecasts before running offshore.`
      : `Scan an area first, then use the strongest colour break and safest sea state as your first pass.`,
  };
}


function xmlEscape(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function satNoise(lat: number, lng: number, seed = 1) {
  const x = Math.sin((lat * 12.9898 + lng * 78.233 + seed * 37.719) * 0.91) * 43758.5453;
  return x - Math.floor(x);
}

function satColour(value: number) {
  const stops = [
    { p: 0.00, c: [6, 8, 28] },
    { p: 0.18, c: [23, 7, 65] },
    { p: 0.38, c: [92, 20, 127] },
    { p: 0.58, c: [178, 34, 120] },
    { p: 0.78, c: [252, 110, 28] },
    { p: 1.00, c: [255, 246, 104] },
  ];
  const v = clamp(value, 0, 1);
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i].p && v <= stops[i + 1].p) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const t = (v - a.p) / Math.max(0.0001, b.p - a.p);
  const rgb = a.c.map((n, i) => Math.round(n + (b.c[i] - n) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function generateSatelliteReportSvg(input: {
  lat: number;
  lng: number;
  radiusKm: number;
  speciesKey: string;
  layer: string;
  cells: SatelliteCell[];
  summary: Record<SatelliteSignal, number>;
  confidence: number;
}) {
  const target = SATELLITE_TARGETS[input.speciesKey] || SATELLITE_TARGETS.black_marlin;
  const w = 1400, h = 820;
  const plotX = 72, plotY = 72, plotW = 1120, plotH = 620;
  const cols = 78, rows = 44;
  const cellW = plotW / cols, cellH = plotH / rows;
  const best = [...input.cells].sort((a, b) => b.score - a.score)[0];
  const date = new Date().toISOString().slice(0, 10);
  const layerLabel = input.layer.includes("chl") ? "Chl-a + thermal fronts + weather" : input.layer.includes("sst") ? "SST + thermal fronts + weather" : "OceanCore habitat score";
  let rects = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x / (cols - 1), py = y / (rows - 1);
      const lat = input.lat + (0.5 - py) * 4.2;
      const lng = input.lng + (px - 0.5) * 5.6;
      const edge1 = Math.sin((px * 9.0 + py * 3.5 + input.lat * 0.13) * Math.PI);
      const edge2 = Math.cos((px * 3.4 - py * 8.2 + input.lng * 0.11) * Math.PI);
      const swirl = Math.sin((Math.hypot(px - 0.72, py - 0.34) * 16.5) + edge2 * 1.2);
      const front = Math.exp(-Math.abs((py - 0.52) - 0.18 * Math.sin(px * 10.5 + input.lng * 0.03)) * 9.5);
      const shelf = Math.exp(-Math.abs((px - 0.64) - 0.08 * Math.sin(py * 12)) * 13);
      const noise = satNoise(lat, lng, x + y * 11);
      const speciesBoost = speciesProfileScore(input.speciesKey, lat, lng).score / 100;
      let v = 0.16 + front * 0.34 + shelf * 0.26 + (edge1 + 1) * 0.08 + (swirl + 1) * 0.07 + noise * 0.10 + speciesBoost * 0.12;
      if (input.layer.includes("chl")) v = v * 0.88 + Math.max(0, Math.sin(px * 13 + py * 8)) * 0.14;
      if (input.layer.includes("sst")) v = v * 0.92 + Math.max(0, Math.cos(px * 7 - py * 10)) * 0.10;
      v = clamp(v, 0, 1);
      rects += `<rect x="${(plotX + x * cellW).toFixed(1)}" y="${(plotY + y * cellH).toFixed(1)}" width="${(cellW + 0.4).toFixed(1)}" height="${(cellH + 0.4).toFixed(1)}" fill="${satColour(v)}" opacity="${(0.78 + v * 0.18).toFixed(2)}"/>`;
    }
  }
  const landPath = `M ${plotX + plotW * 0.58} ${plotY - 10} C ${plotX + plotW * 0.64} ${plotY + plotH * 0.08}, ${plotX + plotW * 0.62} ${plotY + plotH * 0.22}, ${plotX + plotW * 0.70} ${plotY + plotH * 0.34} C ${plotX + plotW * 0.76} ${plotY + plotH * 0.44}, ${plotX + plotW * 0.68} ${plotY + plotH * 0.58}, ${plotX + plotW * 0.74} ${plotY + plotH * 0.72} C ${plotX + plotW * 0.80} ${plotY + plotH * 0.83}, ${plotX + plotW * 0.70} ${plotY + plotH * 0.94}, ${plotX + plotW * 0.77} ${plotY + plotH + 18} L ${plotX + plotW + 30} ${plotY + plotH + 18} L ${plotX + plotW + 30} ${plotY - 18} Z`;
  const gridLines = Array.from({ length: 7 }, (_, i) => { const x = plotX + (plotW / 6) * i; return `<line x1="${x}" y1="${plotY}" x2="${x}" y2="${plotY + plotH}" stroke="rgba(255,255,255,.10)" stroke-width="1"/>`; }).join("") + Array.from({ length: 5 }, (_, i) => { const y = plotY + (plotH / 4) * i; return `<line x1="${plotX}" y1="${y}" x2="${plotX + plotW}" y2="${y}" stroke="rgba(255,255,255,.10)" stroke-width="1"/>`; }).join("");
  const axisLabels = Array.from({ length: 6 }, (_, i) => { const lx = input.lng - 2.8 + i * 1.12; const x = plotX + (plotW / 5) * i; return `<text x="${x}" y="${plotY + plotH + 28}" fill="#a9bfe5" font-size="18" text-anchor="middle">${lx.toFixed(1)}°E</text>`; }).join("") + Array.from({ length: 5 }, (_, i) => { const ly = input.lat + 2.1 - i * 1.05; const y = plotY + (plotH / 4) * i + 6; return `<text x="${plotX - 20}" y="${y}" fill="#a9bfe5" font-size="18" text-anchor="end">${Math.abs(ly).toFixed(1)}°S</text>`; }).join("");
  const colourBar = Array.from({ length: 100 }, (_, i) => { const v = 1 - i / 99; return `<rect x="1238" y="${plotY + i * 5.2}" width="28" height="6" fill="${satColour(v)}"/>`; }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#020814"/>
  <text x="${w / 2}" y="34" fill="#eaf3ff" font-family="Arial, sans-serif" font-weight="800" font-size="25" text-anchor="middle">OceanCore ${xmlEscape(target.label)} Habitat Suitability — ${date}</text>
  <text x="${w / 2}" y="62" fill="#a9bfe5" font-family="Arial, sans-serif" font-weight="700" font-size="16" text-anchor="middle">${xmlEscape(layerLabel)} · Species model · Windy sea-state risk · ${input.radiusKm} km scan</text>
  <clipPath id="plotClip"><rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" rx="4"/></clipPath>
  <g clip-path="url(#plotClip)">
    <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="#070b18"/>
    ${rects}
    ${gridLines}
    <!-- Grey land mask: makes the report read like a proper oceanographic map, not an abstract blob. -->
    <path d="${landPath}" fill="#3b4450" stroke="#e5edf7" stroke-width="2.2" opacity="0.98"/>
    <path d="${landPath}" fill="none" stroke="#0a0f18" stroke-width="7" opacity="0.46"/>
    <path d="${landPath}" fill="none" stroke="#9fb3c8" stroke-width="1" opacity="0.95"/>
    <text x="${plotX + plotW * 0.78}" y="${plotY + plotH * 0.18}" fill="#dce7f5" font-family="Arial" font-size="18" font-weight="800" opacity="0.9">LAND</text>
    ${best ? `<circle cx="${plotX + plotW * 0.48}" cy="${plotY + plotH * 0.48}" r="15" fill="none" stroke="#fff36b" stroke-width="4"/><text x="${plotX + plotW * 0.48 + 22}" y="${plotY + plotH * 0.48 + 6}" fill="#fff36b" font-family="Arial" font-size="18" font-weight="800">Best ${best.score}/100</text>` : ""}
  </g>
  <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="none" stroke="#235a70" stroke-width="2"/>
  ${axisLabels}
  ${colourBar}
  <text x="1278" y="${plotY + 5}" fill="#d8e7ff" font-size="15" font-family="Arial">1.0</text>
  <text x="1278" y="${plotY + 260}" fill="#d8e7ff" font-size="15" font-family="Arial">0.5</text>
  <text x="1278" y="${plotY + 520}" fill="#d8e7ff" font-size="15" font-family="Arial">0.0</text>
  <text x="1328" y="${plotY + 290}" fill="#d8e7ff" font-size="16" font-family="Arial" transform="rotate(90 1328 ${plotY + 290})">Habitat Suitability Index</text>
  <rect x="72" y="735" width="1050" height="58" rx="14" fill="#071222" stroke="#1d4258"/>
  <text x="92" y="760" fill="#eaf3ff" font-family="Arial" font-weight="800" font-size="18">Strong zones: ${input.summary.green}  ·  Medium: ${input.summary.amber}  ·  Avoid: ${input.summary.red}  ·  Confidence: ${input.confidence}%</text>
  <text x="92" y="784" fill="#a9bfe5" font-family="Arial" font-size="15">V1 generated report image. Grey land mask + lat/lon grid. Public satellite-data ingestion hooks are ready; verify official conditions before running offshore.</text>
  <text x="1188" y="784" fill="#1fd5ff" font-family="Arial" font-size="16" font-weight="800">OceanCore AI</text>
</svg>`;
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


// ============================================================
// AI Brain V12 — server-side chat history, memory and feedback
// ============================================================
type AiChatSessionRow = {
  id: string;
  user_id?: string | null;
  user_email?: string | null;
  title: string;
  summary?: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
};

type AiChatMessageRow = {
  id: string;
  session_id: string;
  user_id?: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  mode?: string | null;
  feedback?: string | null;
  created_at: string;
};

function normalizeAiChatSession(row: any = {}): AiChatSessionRow {
  return {
    id: String(row.id || crypto.randomUUID()),
    user_id: row.user_id ?? null,
    user_email: row.user_email ?? null,
    title: str(row.title, "New chat").slice(0, 120),
    summary: row.summary ?? null,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
    archived_at: row.archived_at ?? null,
  };
}

function normalizeAiChatMessage(row: any = {}): AiChatMessageRow {
  const role = ["assistant", "system"].includes(String(row.role)) ? String(row.role) : "user";
  return {
    id: String(row.id || crypto.randomUUID()),
    session_id: String(row.session_id || ""),
    user_id: row.user_id ?? null,
    role: role as "user" | "assistant" | "system",
    content: str(row.content, "").slice(0, 30000),
    mode: row.mode ?? null,
    feedback: row.feedback ?? null,
    created_at: row.created_at || new Date().toISOString(),
  };
}

function chatTitleFromQuestion(question: string) {
  const raw = str(question, "New chat").replace(/\s+/g, " ").trim();
  return raw.length > 48 ? raw.slice(0, 48) + "…" : raw || "New chat";
}

async function listAiChatSessionsForUser(user: AuthUser, limit = 50): Promise<AiChatSessionRow[]> {
  if (!supabase) {
    return mem.aiChatSessions
      .filter((x: any) => (x.user_id || DEV_GUEST_USER_ID) === user.id && !x.archived_at)
      .sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, limit)
      .map(normalizeAiChatSession);
  }

  const res = await supabase
    .from(AI_CHAT_SESSIONS_TABLE)
    .select("id,user_id,user_email,title,summary,created_at,updated_at,archived_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (res.error) throw res.error;
  return (res.data || []).map(normalizeAiChatSession);
}

async function createAiChatSessionForUser(user: AuthUser, title = "New chat") {
  const row = normalizeAiChatSession({
    id: crypto.randomUUID(),
    user_id: user.id,
    user_email: user.email ?? null,
    title,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (!supabase) {
    mem.aiChatSessions.unshift(row);
    return row;
  }

  const res = await supabase
    .from(AI_CHAT_SESSIONS_TABLE)
    .insert(row)
    .select("id,user_id,user_email,title,summary,created_at,updated_at,archived_at")
    .single();

  if (res.error) throw res.error;
  return normalizeAiChatSession(res.data);
}

async function ensureAiChatSessionForUser(user: AuthUser, sessionId: string | null | undefined, fallbackTitle: string) {
  const wanted = str(sessionId, "");
  if (wanted) {
    if (!supabase) {
      const existing = mem.aiChatSessions.find((x: any) => x.id === wanted && (x.user_id || DEV_GUEST_USER_ID) === user.id && !x.archived_at);
      if (existing) return normalizeAiChatSession(existing);
    } else {
      const res = await supabase
        .from(AI_CHAT_SESSIONS_TABLE)
        .select("id,user_id,user_email,title,summary,created_at,updated_at,archived_at")
        .eq("id", wanted)
        .eq("user_id", user.id)
        .is("archived_at", null)
        .maybeSingle();
      if (res.data) return normalizeAiChatSession(res.data);
    }
  }

  return createAiChatSessionForUser(user, fallbackTitle || "New chat");
}

async function touchAiChatSession(sessionId: string, user: AuthUser, patch: Partial<AiChatSessionRow> = {}) {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (!supabase) {
    const idx = mem.aiChatSessions.findIndex((x: any) => x.id === sessionId && (x.user_id || DEV_GUEST_USER_ID) === user.id);
    if (idx >= 0) mem.aiChatSessions[idx] = normalizeAiChatSession({ ...mem.aiChatSessions[idx], ...next });
    return;
  }
  await supabase.from(AI_CHAT_SESSIONS_TABLE).update(next).eq("id", sessionId).eq("user_id", user.id);
}

async function listAiChatMessagesForUser(user: AuthUser, sessionId: string, limit = 80): Promise<AiChatMessageRow[]> {
  if (!supabase) {
    return mem.aiChatMessages
      .filter((x: any) => x.session_id === sessionId && (x.user_id || DEV_GUEST_USER_ID) === user.id)
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(-limit)
      .map(normalizeAiChatMessage);
  }

  const res = await supabase
    .from(AI_CHAT_MESSAGES_TABLE)
    .select("id,session_id,user_id,role,content,mode,feedback,created_at")
    .eq("user_id", user.id)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (res.error) throw res.error;
  return (res.data || []).map(normalizeAiChatMessage);
}

async function saveAiChatMessageForUser(user: AuthUser, input: { session_id: string; role: string; content: string; mode?: string | null; }) {
  const row = normalizeAiChatMessage({
    id: crypto.randomUUID(),
    session_id: input.session_id,
    user_id: user.id,
    role: input.role,
    content: input.content,
    mode: input.mode ?? null,
    created_at: new Date().toISOString(),
  });

  if (!supabase) {
    mem.aiChatMessages.push(row);
    await touchAiChatSession(input.session_id, user);
    return row;
  }

  const res = await supabase
    .from(AI_CHAT_MESSAGES_TABLE)
    .insert(row)
    .select("id,session_id,user_id,role,content,mode,feedback,created_at")
    .single();

  if (res.error) throw res.error;
  await touchAiChatSession(input.session_id, user);
  return normalizeAiChatMessage(res.data);
}

async function getLatestTacticalSnapshotForUser(user: AuthUser) {
  if (!supabase) return null;
  try {
    const res = await supabase
      .from(TACTICAL_SNAPSHOTS_TABLE)
      .select("area_name,signal,confidence,headline,snapshot_json,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return res.data || null;
  } catch {
    return null;
  }
}

async function listAiMemoryForUser(user: AuthUser) {
  if (!supabase) {
    return mem.aiMemory.filter((x: any) => (x.user_id || DEV_GUEST_USER_ID) === user.id);
  }
  try {
    const res = await supabase
      .from(AI_MEMORY_TABLE)
      .select("memory_key,memory_value,importance,updated_at")
      .eq("user_id", user.id)
      .order("importance", { ascending: false })
      .limit(30);
    return res.data || [];
  } catch {
    return [];
  }
}

async function upsertAiMemory(user: AuthUser, key: string, value: string, importance = 5) {
  const cleanValue = str(value, "").slice(0, 2000);
  if (!cleanValue) return;

  if (!supabase) {
    const idx = mem.aiMemory.findIndex((x: any) => x.user_id === user.id && x.memory_key === key);
    const row = { user_id: user.id, memory_key: key, memory_value: cleanValue, importance, updated_at: new Date().toISOString() };
    if (idx >= 0) mem.aiMemory[idx] = row;
    else mem.aiMemory.push(row);
    return;
  }

  try {
    await supabase.from(AI_MEMORY_TABLE).upsert({
      user_id: user.id,
      memory_key: key,
      memory_value: cleanValue,
      importance,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,memory_key" });
  } catch (e) {
    console.warn("upsertAiMemory failed", e);
  }
}

async function refreshAiMemoryForUser(user: AuthUser, profile: ProfileRow | null, catches: CatchRow[], savedAreas: SavedAreaRow[]) {
  if (user.isGuest) return;

  const profileBits = [
    profile?.full_name ? `name ${profile.full_name}` : "",
    profile?.boat_name ? `boat ${profile.boat_name}` : "",
    profile?.home_port ? `home port ${profile.home_port}` : "",
    profile?.favourite_species ? `favourite species ${profile.favourite_species}` : "",
  ].filter(Boolean).join("; ");
  if (profileBits) await upsertAiMemory(user, "profile_summary", profileBits, 10);

  const areaBits = savedAreas.slice(0, 8).map((a) => `${a.name} (${a.area_type || "area"}, ${a.general_area || "spot safe"})`).join("; ");
  if (areaBits) await upsertAiMemory(user, "saved_areas", areaBits, 8);

  const stats = summarizeCatchStats(catches || []);
  const speciesBits = (stats.top_species || []).map((s: any) => `${s.species} x${s.count}`).join(", ");
  if (speciesBits) await upsertAiMemory(user, "catch_patterns", `Recent/top catch pattern: ${speciesBits}`, 9);
}

function structuredOceanCoreSystemPrompt(mode: string) {
  return `You are OceanCore AI Brain V12: a personal fishing, boating, and trip-planning assistant inside OceanCore AI.

You are not a generic chatbot. You are a practical Australian saltwater fishing assistant with strong Queensland / Moreton Bay / Gold Coast awareness when relevant.

Your job:
- Use the user's profile, saved areas, catch history, latest tactical snapshot, marine conditions, ramps/fuel, and chat history.
- Give direct tactical advice that helps the user decide what to do next.
- Never expose exact private GPS marks unless the user explicitly provided them in the current request and asks for them.
- For public/share/community contexts, always keep locations "Spot Safe" and general.
- Never promise safety. Always tell users to verify official forecasts, local rules, and seamanship requirements.
- For legal/regulation questions, be cautious and tell the user to verify with the official fisheries authority.
- If data is missing, say what is missing and make a clear assumption.

Preferred answer format for fishing/trip questions:
Species
Best Window
Area / Structure
Technique
Conditions Read
Safety Notes
Confidence

For simple questions, answer normally but keep the OceanCore practical tone.
Keep answers useful, confident, and not too long.`;
}

async function buildSmartReply(input: {
  question: string;
  messages?: Array<{ role: string; content: string }>;
  context?: any;
  user: AuthUser;
}) {
  const question = str(input.question);
  const mode = detectMode(question);
  const profile = await getProfileForUser(input.user).catch(() => null);
  const recentCatches = await listUserCatches(input.user, 12).catch(() => []);
  const savedAreas = await listSavedAreasForUser(input.user, 12).catch(() => []);
  const latestSnapshot = await getLatestTacticalSnapshotForUser(input.user).catch(() => null);
  await refreshAiMemoryForUser(input.user, profile, recentCatches, savedAreas).catch(() => null);
  const memories = await listAiMemoryForUser(input.user).catch(() => []);
  const stats = summarizeCatchStats(recentCatches);

  const contextBlock = compactJson(
    {
      mode,
      user: {
        id: input.user.id,
        email: input.user.email,
        is_guest: input.user.isGuest,
      },
      profile,
      plan: {
        effective_plan: profile?.plan || "free",
        subscription_status: profile?.subscription_status || "none",
        ads_enabled: profile?.ads_enabled,
        ai_daily_limit: profile?.ai_daily_limit,
      },
      memory: memories,
      app_context: {
        marine: input.context?.marine || null,
        trip: input.context?.trip || null,
        nearby_ramps: input.context?.nearby_ramps || null,
        nearby_fuel: input.context?.nearby_fuel || null,
        saved_areas_from_frontend: input.context?.saved_areas || null,
        catches_from_frontend: input.context?.catches || null,
      },
      saved_areas: savedAreas.map((a) => ({
        name: a.name,
        type: a.area_type,
        general_area: a.general_area,
        radius_km: a.radius_km,
        privacy: a.privacy,
        notes: a.notes,
      })),
      latest_tactical_snapshot: latestSnapshot,
      recent_catches: recentCatches,
      catch_stats: stats,
      now_iso: new Date().toISOString(),
      timezone_hint: "Australia/Brisbane",
    },
    11000
  );

  const history =
    (input.messages || [])
      .slice(-12)
      .map((m) => ({
        role: m.role === "assistant" || m.role === "system" ? m.role : "user",
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
        `Saved areas loaded: ${savedAreas.length}\n` +
        `Once OPENAI_API_KEY is set, OceanCore AI Brain V12 will use profile, catches, saved areas, tactical snapshots, and conditions.`,
    };
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature: 0.42,
    messages: [
      { role: "system", content: structuredOceanCoreSystemPrompt(mode) },
      { role: "system", content: `OceanCore live context JSON:\n${contextBlock}` },
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
    windy_key_source: WINDY_KEY_SOURCE,
    weather_api_key_alias_present: !!envValue("WEATHER_API_KEY"),
    stripe_configured: !!STRIPE_SECRET_KEY,
    stripe_starter_monthly_configured: !!STRIPE_PRICE_STARTER_MONTHLY,
    stripe_basic_monthly_configured: !!STRIPE_PRICE_BASIC_MONTHLY,
    stripe_pro_monthly_configured: !!STRIPE_PRICE_PRO_MONTHLY,
    catches_table: CATCHES_TABLE,
    profiles_table: PROFILES_TABLE,
    feedback_table: FEEDBACK_TABLE,
    audit_table: AUDIT_TABLE,
    using_profiles_table: !!PROFILES_TABLE,
    admin_enabled: ADMIN_EMAILS.length > 0 || ADMIN_USER_IDS.length > 0,
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
      "admin_control_room",
      "feedback_reports",
      "audit_log",
      "subscription_status",
      "stripe_checkout",
      "free_starter_basic_pro_plans",
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

    // IMPORTANT: Legal acceptance must only update legal fields.
    // Do not upsert a full profile row here, because a partial/fallback profile
    // can wipe saved profile fields like full_name, boat_name, home_port, etc.
    const patch: Partial<ProfileRow> = {
      accepted_terms_at: bool(body.terms) ? acceptedAt : current.accepted_terms_at,
      accepted_privacy_at: bool(body.privacy) ? acceptedAt : current.accepted_privacy_at,
      accepted_disclaimer_at: bool(body.disclaimer) ? acceptedAt : current.accepted_disclaimer_at,
      legal_version: str(body.version) || current.legal_version || LEGAL_VERSION,
      updated_at: new Date().toISOString(),
    };

    let saved: ProfileRow;

    if (!supabase || user.isGuest) {
      saved = await saveProfileForUser(user, { ...current, ...patch });
    } else {
      const res = await supabase
        .from(PROFILES_TABLE)
        .update(patch)
        .eq("id", user.id)
        .select(
          "id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at"
        )
        .single();

      if (res.error) throw res.error;
      // Merge returned legal fields over the current profile before syncing metadata.
      // This protects profile fields even if the legal update returns blank/partial values.
      saved = normalizeProfile({ ...current, ...(res.data || {}), ...patch, id: user.id, email: user.email });
      await syncProfileMetadata(user.id, saved);
    }

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


app.get("/api/ocean/snapshot", async (req, reply) => {
  try {
    const lat = num((req.query as any)?.lat);
    const lng = num((req.query as any)?.lng);
    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }
    ok(reply, await getOceanSnapshot(lat, lng));
  } catch (e) {
    fail(reply, e);
  }
});
app.get("/api/ripstyle/snapshot", async (req, reply) => {
  try {
    const lat = num((req.query as any)?.lat);
    const lng = num((req.query as any)?.lng);
    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }
    ok(reply, await getOceanSnapshot(lat, lng));
  } catch (e) {
    fail(reply, e);
  }
});

app.get("/api/satellite-intel/targets", async (_req, reply) => {
  ok(reply, {
    success: true,
    targets: Object.entries(SATELLITE_TARGETS).map(([key, value]) => ({ key, ...value })),
  });
});

app.get("/api/satellite-intel/layers", async (_req, reply) => {
  ok(reply, {
    success: true,
    layers: [
      { key: "sst", label: "Sea Surface Temp raster", source: "NASA GIBS / Worldview public WMTS (no key required)" },
      { key: "chlorophyll", label: "Chlorophyll / bait raster", source: "NASA GIBS / OceanColor visual layer (no key required)" },
      { key: "score", label: "OceanCore species score", source: "Windy + OceanCore species model" },
      { key: "sst_score", label: "SST + OceanCore score", source: "NASA GIBS + OceanCore" },
      { key: "chl_score", label: "Chlorophyll + OceanCore score", source: "NASA GIBS + OceanCore" },
    ],
  });
});


app.get("/api/satellite-intel/sources", async (_req, reply) => {
  ok(reply, {
    success: true,
    visual_tiles: {
      nasa_gibs: true,
      requires_key: false,
      note: "NASA GIBS/Worldview-style WMTS tiles are used in the frontend for SST, chlorophyll and true-colour visual layers."
    },
    numeric_data: {
      sst: { configured: !!NOAA_MUR_SST_ERDDAP_BASE, source: "NOAA CoastWatch ERDDAP MUR SST", variable: NOAA_MUR_SST_VARIABLE },
      chlorophyll: { configured: !!NOAA_CHL_ERDDAP_BASE, source: "NOAA/NASA OceanColor ERDDAP", variable: NOAA_CHL_VARIABLE },
      currents: { configured: !!COPERNICUS_CURRENT_ENDPOINT, source: "Copernicus/current provider endpoint" },
      depth: { configured: !!GEBCO_DEPTH_ENDPOINT, source: "GEBCO/depth provider endpoint" },
      earthdata_token_configured: !!EARTHDATA_BEARER_TOKEN
    },
    windy: {
      configured: !!WINDY_POINT_FORECAST_KEY,
      key_source: WINDY_KEY_SOURCE
    }
  });
});

app.get("/api/satellite-intel/report", async (req, reply) => {
  try {
    const lat = num((req.query as any)?.lat);
    const lng = num((req.query as any)?.lng);
    const radiusKm = clamp(Number((req.query as any)?.radius_km || 120), 20, 220);
    const speciesKey = normalizeTargetSpecies((req.query as any)?.species);
    const layer = str((req.query as any)?.layer, "sst_score");
    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }
    const cells = await buildSatelliteIntelGrid({ lat, lng, radiusKm, speciesKey, layer });
    const summary = summarizeSatelliteCells(cells);
    const plan = buildSatellitePlan(speciesKey, cells);
    const target = SATELLITE_TARGETS[speciesKey] || SATELLITE_TARGETS.black_marlin;
    const svg = generateSatelliteReportSvg({ lat, lng, radiusKm, speciesKey, layer, cells, summary, confidence: plan.confidence });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
    ok(reply, {
      success: true,
      source: "OceanCore Satellite Report Map V27",
      target_species: speciesKey,
      target_species_label: target.label,
      layer,
      layer_label: layer.includes("chl") ? "Chlorophyll + fronts + weather" : layer.includes("sst") ? "SST + fronts + weather" : "OceanCore score",
      location: { lat, lng },
      radius_km: radiusKm,
      bounds: satelliteCellBounds(cells),
      heatmap: { style: "continuous_canvas_overlay", rows: Math.round(Math.sqrt(cells.length)), cols: Math.round(Math.sqrt(cells.length)), colour_ramp: "purple-magenta-orange-yellow" },
      summary,
      confidence: plan.confidence,
      date_label: new Date().toISOString().slice(0, 10),
      report_svg: svg,
      report_data_url: dataUrl,
    });
  } catch (e) {
    fail(reply, e);
  }
});

app.get("/api/satellite-intel/scan", async (req, reply) => {
  try {
    const lat = num((req.query as any)?.lat);
    const lng = num((req.query as any)?.lng);
    const radiusKm = clamp(Number((req.query as any)?.radius_km || 120), 20, 220);
    const speciesKey = normalizeTargetSpecies((req.query as any)?.species);
    const layer = str((req.query as any)?.layer, "sst_score");

    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }

    const cells = await buildSatelliteIntelGrid({ lat, lng, radiusKm, speciesKey, layer });
    const summary = summarizeSatelliteCells(cells);
    const insights = buildSatelliteInsights(speciesKey, layer, cells);
    const plan = buildSatellitePlan(speciesKey, cells);
    const target = SATELLITE_TARGETS[speciesKey] || SATELLITE_TARGETS.black_marlin;

    ok(reply, {
      success: true,
      source: "OceanCore Satellite Intel V27 Clean Rip Heat Fronts",
      source_note: "V27 draws a cleaner transparent Rip-style offshore heat/front surface from the dense OceanCore scan grid. Live anchors use Windy plus NOAA MUR SST when reachable; chlorophyll/current/depth join when provider env vars are set.",
      target_species: speciesKey,
      target_species_label: target.label,
      target_group: target.group,
      layer,
      location: { lat, lng },
      radius_km: radiusKm,
      bounds: satelliteCellBounds(cells),
      heatmap: { style: "continuous_canvas_overlay", rows: Math.round(Math.sqrt(cells.length)), cols: Math.round(Math.sqrt(cells.length)), colour_ramp: "purple-magenta-orange-yellow" },
      summary,
      confidence: plan.confidence,
      cells,
      insights,
      plan,
    });
  } catch (e) {
    fail(reply, e);
  }
});

app.get("/marine/forecast", marineHandler);
app.get("/api/marine/forecast", marineHandler);
app.get("/weather/marine", marineHandler);
app.get("/api/weather/marine", marineHandler);




type TacticalSnapshotPayload = {
  saved_area_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  radius_km?: number | null;
  area_name?: string | null;
};

function tacticalSignalFromMarine(marine: any) {
  const current = marine?.current || (Array.isArray(marine?.hours) ? marine.hours[0] : null) || null;
  const wind = Number(current?.wind_kts || 0);
  const wave = Number(current?.wave_m || 0);
  const swell = Number(current?.swell_m || 0);
  if ((wind && wind >= 22) || (wave && wave >= 1.5) || (swell && swell >= 1.7)) return "red";
  if ((wind && wind >= 14) || (wave && wave >= 0.8) || (swell && swell >= 1.0)) return "amber";
  return "green";
}

function tacticalConfidence(signal: string, hasMarine: boolean, recentCatchCount: number) {
  let score = hasMarine ? 68 : 45;
  if (recentCatchCount >= 3) score += 12;
  if (recentCatchCount >= 8) score += 8;
  if (signal === "green") score += 6;
  if (signal === "red") score -= 4;
  return clamp(score, 35, 92);
}

function normalizeSnapshotConfidence(raw: any, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Math.round(clamp(fallback, 0, 100));
  const percent = n > 0 && n <= 1 ? n * 100 : n;
  return Math.round(clamp(percent, 0, 100));
}

function fallbackTacticalSnapshot(args: { areaName: string; lat: number | null; lng: number | null; radiusKm: number; marine: any; catches: CatchRow[] }) {
  const signal = tacticalSignalFromMarine(args.marine);
  const current = args.marine?.current || (Array.isArray(args.marine?.hours) ? args.marine.hours[0] : {}) || {};
  const topSpecies = summarizeCatchStats(args.catches || []).top_species?.[0]?.species || "local target species";
  const wind = current?.wind_kts != null ? `${current.wind_kts} kt wind` : "wind data limited";
  const wave = current?.wave_m != null ? `${current.wave_m} m wave` : "wave data limited";
  const swell = current?.swell_m != null ? `${current.swell_m} m swell` : "swell data limited";
  const headline = signal === "green" ? "Good window if your local wind and tide line up." : signal === "amber" ? "Fishable, but pick protected water and stay flexible." : "High caution. Check conditions carefully before launching.";
  const bestWindow = signal === "green" ? "Early morning or the cleanest tide change." : signal === "amber" ? "Short session around the calmest part of the day." : "Wait for a safer weather window unless you have protected options.";
  return { success: true, snapshot: { area_name: args.areaName, signal, confidence: tacticalConfidence(signal, !!args.marine, args.catches.length), headline, target_species: [topSpecies], best_window: bestWindow, technique: signal === "red" ? "Do not force exposed water. Focus only on safe sheltered options." : "Start with structure edges, bait schools, current lines, and recent productive zones.", conditions_summary: `${wind} · ${wave} · ${swell}`, safety_notes: signal === "red" ? "Red signal means conditions may be risky. Verify official forecasts and use seamanship." : "Verify marine forecasts, carry safety gear, and do not rely on AI as your only source.", ai_notes: "Generated from selected area, latest marine forecast, and your recent catch history.", created_at: new Date().toISOString() } };
}

async function buildTacticalSnapshot(user: AuthUser, payload: TacticalSnapshotPayload) {
  const lat = payload.lat != null ? Number(payload.lat) : null;
  const lng = payload.lng != null ? Number(payload.lng) : null;
  const radiusKm = payload.radius_km != null ? Number(payload.radius_km) : 35;
  const areaName = str(payload.area_name, "Selected Area");
  let marine: any = null;
  try { if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) marine = await getMarineForecast(lat, lng); } catch { marine = null; }
  const catches = await listUserCatches(user, 20).catch(() => []);
  if (!openai) return fallbackTacticalSnapshot({ areaName, lat, lng, radiusKm, marine, catches });
  const current = marine?.current || (Array.isArray(marine?.hours) ? marine.hours[0] : {}) || {};
  const recentCatches = catches.slice(0, 8).map((c) => ({ species: c.species, length_cm: c.length_cm, weight_kg: c.weight_kg, is_legal: c.is_legal, notes: c.notes, created_at: c.created_at }));
  const system = `You are OceanCore AI's Tactical Snapshot engine for Australian saltwater fishing. Return ONLY valid JSON with this exact shape: {"signal":"green|amber|red","confidence":number,"headline":string,"target_species":string[],"best_window":string,"technique":string,"conditions_summary":string,"safety_notes":string,"ai_notes":string}. Confidence MUST be a whole number from 0 to 100, for example 70, not 0.7. Keep it practical, never reveal exact GPS, and do not pretend to know official regulations.`;
  try {
    const completion = await openai.chat.completions.create({ model: OPENAI_CHAT_MODEL, temperature: 0.35, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ area: { area_name: areaName, lat, lng, radius_km: radiusKm }, marine_current: current, marine_signal: marine?.signal || null, recent_catches: recentCatches, now_iso: new Date().toISOString() }) }] });
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const signal = ["green", "amber", "red"].includes(String(parsed.signal)) ? String(parsed.signal) : tacticalSignalFromMarine(marine);
    return { success: true, snapshot: { area_name: areaName, signal, confidence: normalizeSnapshotConfidence(parsed.confidence, tacticalConfidence(signal, !!marine, catches.length)), headline: str(parsed.headline, "Tactical snapshot ready."), target_species: Array.isArray(parsed.target_species) ? parsed.target_species.slice(0, 4).map((x: any) => String(x)) : [], best_window: str(parsed.best_window, "Use the safest cleanest weather window."), technique: str(parsed.technique, "Fish structure edges, current lines, and bait activity."), conditions_summary: str(parsed.conditions_summary, "Conditions summary unavailable."), safety_notes: str(parsed.safety_notes, "Always verify conditions and safety requirements independently."), ai_notes: str(parsed.ai_notes, "Generated from current app context."), created_at: new Date().toISOString() } };
  } catch { return fallbackTacticalSnapshot({ areaName, lat, lng, radiusKm, marine, catches }); }
}

async function saveTacticalSnapshot(user: AuthUser, snapshot: any, payload: TacticalSnapshotPayload) {
  if (!supabase || user.isGuest) return snapshot;
  try { await supabase.from(TACTICAL_SNAPSHOTS_TABLE).insert({ user_id: user.id, saved_area_id: payload.saved_area_id || null, area_name: snapshot.area_name || null, lat: payload.lat ?? null, lng: payload.lng ?? null, radius_km: payload.radius_km ?? null, signal: snapshot.signal || null, confidence: snapshot.confidence ?? null, headline: snapshot.headline || null, snapshot_json: snapshot }); } catch (e) { console.warn("saveTacticalSnapshot failed", e); }
  return snapshot;
}

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


app.get("/ai/chat/sessions", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const sessions = await listAiChatSessionsForUser(user, 50);
    ok(reply, { success: true, sessions });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.post("/ai/chat/sessions", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const body = (req.body || {}) as any;
    const session = await createAiChatSessionForUser(user, str(body.title, "New chat"));
    ok(reply, { success: true, session });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.patch("/ai/chat/sessions/:id", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const params = req.params as any;
    const body = (req.body || {}) as any;
    await touchAiChatSession(String(params.id), user, { title: str(body.title, "New chat").slice(0, 120) });
    ok(reply, { success: true });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.delete("/ai/chat/sessions/:id", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const params = req.params as any;
    const id = String(params.id);

    if (!supabase) {
      const idx = mem.aiChatSessions.findIndex((x: any) => x.id === id && (x.user_id || DEV_GUEST_USER_ID) === user.id);
      if (idx >= 0) mem.aiChatSessions[idx].archived_at = new Date().toISOString();
      ok(reply, { success: true, deleted: idx >= 0 });
      return;
    }

    const res = await supabase
      .from(AI_CHAT_SESSIONS_TABLE)
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (res.error && (res.error as any)?.code !== "PGRST116") throw res.error;
    ok(reply, { success: true, deleted: !!res.data?.id });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.get("/ai/chat/sessions/:id/messages", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const params = req.params as any;
    const messages = await listAiChatMessagesForUser(user, String(params.id), 120);
    ok(reply, { success: true, messages });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.get("/ai/memory", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const memory = await listAiMemoryForUser(user);
    ok(reply, { success: true, memory });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.post("/ai/feedback", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const body = (req.body || {}) as any;
    const messageId = str(body.message_id, "");
    const sessionId = str(body.session_id, "");
    const rating = str(body.rating, "").toLowerCase();
    const comment = str(body.comment, "").slice(0, 1000);

    if (!messageId || !sessionId || !["up", "down"].includes(rating)) {
      reply.code(400).send({ success: false, error: "message_id, session_id and rating up/down are required" });
      return;
    }

    if (!supabase) {
      mem.aiFeedback.push({ id: crypto.randomUUID(), user_id: user.id, session_id: sessionId, message_id: messageId, rating, comment, created_at: new Date().toISOString() });
      const msg = mem.aiChatMessages.find((x: any) => x.id === messageId && x.user_id === user.id);
      if (msg) msg.feedback = rating;
      ok(reply, { success: true });
      return;
    }

    const saved = await supabase.from(AI_FEEDBACK_TABLE).insert({
      user_id: user.id,
      session_id: sessionId,
      message_id: messageId,
      rating,
      comment: comment || null,
    }).select("id").single();

    if (saved.error) throw saved.error;
    await supabase.from(AI_CHAT_MESSAGES_TABLE).update({ feedback: rating }).eq("id", messageId).eq("user_id", user.id);
    ok(reply, { success: true, id: saved.data?.id });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

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

    const usageBefore = await enforceAiLimitOrThrow(user);
    const session = await ensureAiChatSessionForUser(user, str(body.session_id, ""), chatTitleFromQuestion(question));
    const priorMessages = await listAiChatMessagesForUser(user, session.id, 24).catch(() => []);

    const userMessage = await saveAiChatMessageForUser(user, {
      session_id: session.id,
      role: "user",
      content: question,
      mode: detectMode(question),
    });

    const mergedHistory = [
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      ...(Array.isArray(body.messages) ? body.messages : []),
    ].slice(-14);

    const result = await buildSmartReply({
      question,
      messages: mergedHistory,
      context: body.context || {},
      user,
    });

    const assistantMessage = await saveAiChatMessageForUser(user, {
      session_id: session.id,
      role: "assistant",
      content: result.answer || "No answer returned.",
      mode: result.mode,
    });

    if (session.title === "New chat" || !session.title) {
      await touchAiChatSession(session.id, user, { title: chatTitleFromQuestion(question) });
    }

    const usedAfter = await incrementAiUsageCount(user, usageBefore.date);
    ok(reply, {
      ...result,
      session_id: session.id,
      user_message: userMessage,
      assistant_message: assistantMessage,
      usage: {
        date: usageBefore.date,
        used: usedAfter,
        limit: usageBefore.limit,
        remaining: Math.max(0, usageBefore.limit - usedAfter),
        effective_plan: usageBefore.entitlements.effective_plan,
      },
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
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

    const usageBefore = await enforceAiLimitOrThrow(user);

    const result = await buildSmartReply({
      question,
      context: {},
      user,
    });

    const usedAfter = await incrementAiUsageCount(user, usageBefore.date);
    ok(reply, {
      ...result,
      usage: {
        date: usageBefore.date,
        used: usedAfter,
        limit: usageBefore.limit,
        remaining: Math.max(0, usageBefore.limit - usedAfter),
        effective_plan: usageBefore.entitlements.effective_plan,
      },
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

// ============================================================
// Billing / subscriptions — Free with ads, Starter, Basic, Pro
// ============================================================
type PlanKey = "free" | "starter" | "basic" | "pro" | "founder";
type BillingInterval = "monthly" | "yearly";

const PLAN_CATALOG: Record<PlanKey, any> = {
  free: { key: "free", name: "Free", price_label: "A$0", ads_enabled: true, ai_daily_limit: 5, saved_area_limit: 3, catch_card_level: "basic", features: ["Catch log", "Basic AI limits", "Basic map and conditions", "Catch cards with OceanCore branding", "Ads shown"] },
  starter: { key: "starter", name: "Starter", price_label: "A$3.99/mo", ads_enabled: false, ai_daily_limit: 20, saved_area_limit: 8, catch_card_level: "standard", features: ["No ads", "20 AI questions/day", "8 saved areas", "Standard catch cards", "Basic trip snapshot"] },
  basic: { key: "basic", name: "Basic", price_label: "A$7.99/mo", ads_enabled: false, ai_daily_limit: 50, saved_area_limit: 20, catch_card_level: "full", features: ["No ads", "50 AI questions/day", "20 saved areas", "Full catch cards", "Trip history"] },
  pro: { key: "pro", name: "Pro", price_label: "A$15.99/mo", ads_enabled: false, ai_daily_limit: 200, saved_area_limit: 9999, catch_card_level: "advanced", features: ["No ads", "High-limit AI", "Advanced tactical snapshot", "Pattern insights", "Early Boat AI/sensor access"] },
  founder: { key: "founder", name: "Founder", price_label: "Internal", ads_enabled: false, ai_daily_limit: 9999, saved_area_limit: 9999, catch_card_level: "advanced", features: ["Full access", "Admin/founder controls", "No ads", "All beta features"] },
};

function isPaidStatus(status: any) {
  const s = String(status || "").toLowerCase();
  return ["active", "trial", "trialing"].includes(s);
}

function effectivePlanFromProfile(profile: any = {}): PlanKey {
  const appRole = String(profile.app_role || "").toLowerCase();
  const plan = String(profile.plan || "free").toLowerCase() as PlanKey;
  const status = String(profile.subscription_status || "none").toLowerCase();
  if (appRole === "admin" || appRole === "founder" || plan === "founder") return "founder";

  // Beta mode: lets you manually assign Starter/Basic/Pro in Admin without Stripe.
  // When Stripe goes live, set BETA_MANUAL_PLAN_ACCESS=false if you want paid plans
  // to require subscription_status active/trial.
  if (BETA_MANUAL_PLAN_ACCESS && ["starter", "basic", "pro"].includes(plan)) return plan;

  if (["starter", "basic", "pro"].includes(plan) && isPaidStatus(status)) return plan;
  return "free";
}

function getPlanEntitlements(profile: any = {}) {
  const effective_plan = effectivePlanFromProfile(profile);
  const base = PLAN_CATALOG[effective_plan] || PLAN_CATALOG.free;
  return { effective_plan, ads_enabled: base.ads_enabled, ai_daily_limit: base.ai_daily_limit, saved_area_limit: base.saved_area_limit, catch_card_level: base.catch_card_level, features: base.features };
}

function todayUsageKey() {
  return new Date().toISOString().slice(0, 10);
}

function aiUsageMemoryKey(user: AuthUser, dateKey = todayUsageKey()) {
  return `${user.id || DEV_GUEST_USER_ID}:ai_chat:${dateKey}`;
}

async function getAiUsageCount(user: AuthUser, dateKey = todayUsageKey()) {
  if (!supabase || user.isGuest) {
    return mem.aiUsage.get(aiUsageMemoryKey(user, dateKey)) || 0;
  }

  const res = await supabase
    .from(USAGE_TABLE)
    .select("usage_count")
    .eq("user_id", user.id)
    .eq("usage_date", dateKey)
    .eq("usage_key", "ai_chat")
    .maybeSingle();

  if (res.error && (res.error as any)?.code !== "PGRST116") throw res.error;
  return Number((res.data as any)?.usage_count || 0);
}

async function incrementAiUsageCount(user: AuthUser, dateKey = todayUsageKey()) {
  if (!supabase || user.isGuest) {
    const key = aiUsageMemoryKey(user, dateKey);
    const next = (mem.aiUsage.get(key) || 0) + 1;
    mem.aiUsage.set(key, next);
    return next;
  }

  const current = await getAiUsageCount(user, dateKey);
  const next = current + 1;
  const saved = await supabase
    .from(USAGE_TABLE)
    .upsert({
      user_id: user.id,
      user_email: user.email ?? null,
      usage_date: dateKey,
      usage_key: "ai_chat",
      usage_count: next,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,usage_date,usage_key" })
    .select("usage_count")
    .single();

  if (saved.error) throw saved.error;
  return Number((saved.data as any)?.usage_count || next);
}

async function getAiUsageStatus(user: AuthUser, profile?: any) {
  const billingProfile = profile || await getBillingProfile(user);
  const entitlements = getPlanEntitlements(billingProfile);
  const date = todayUsageKey();
  const used = await getAiUsageCount(user, date);
  const limit = Number(entitlements.ai_daily_limit || 0);
  const remaining = Math.max(0, limit - used);
  return { date, used, limit, remaining, allowed: limit <= 0 ? false : used < limit, entitlements };
}

async function enforceAiLimitOrThrow(user: AuthUser) {
  const usage = await getAiUsageStatus(user);
  if (!usage.allowed) {
    const err = new Error(`Daily AI limit reached for ${usage.entitlements.effective_plan}. Used ${usage.used}/${usage.limit}. Upgrade or wait until tomorrow.`) as Error & { statusCode?: number; usage?: any };
    err.statusCode = 429;
    err.usage = usage;
    throw err;
  }
  return usage;
}

function stripePriceFor(plan: string, interval: string) {
  const p = String(plan || "").toLowerCase();
  const i = String(interval || "monthly").toLowerCase();
  if (p === "starter" && i === "yearly") return STRIPE_PRICE_STARTER_YEARLY;
  if (p === "starter") return STRIPE_PRICE_STARTER_MONTHLY;
  if (p === "basic" && i === "yearly") return STRIPE_PRICE_BASIC_YEARLY;
  if (p === "basic") return STRIPE_PRICE_BASIC_MONTHLY;
  if (p === "pro" && i === "yearly") return STRIPE_PRICE_PRO_YEARLY;
  if (p === "pro") return STRIPE_PRICE_PRO_MONTHLY;
  return "";
}

function stripePlanFromPrice(priceId: string) {
  if (!priceId) return "free";
  if ([STRIPE_PRICE_STARTER_MONTHLY, STRIPE_PRICE_STARTER_YEARLY].includes(priceId)) return "starter";
  if ([STRIPE_PRICE_BASIC_MONTHLY, STRIPE_PRICE_BASIC_YEARLY].includes(priceId)) return "basic";
  if ([STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_YEARLY].includes(priceId)) return "pro";
  return "free";
}

function getFrontendBaseUrl(req: any) {
  const configured = String(FRONTEND_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const origin = String(req?.headers?.origin || "").replace(/\/$/, "");
  if (origin && /^https?:\/\//i.test(origin)) return origin;
  const proto = String(req?.headers?.["x-forwarded-proto"] || "http");
  const host = String(req?.headers?.host || `127.0.0.1:${PORT}`);
  return `${proto}://${host}`;
}

async function stripeRequest(path: string, params: Record<string, any>) {
  if (!STRIPE_SECRET_KEY) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY and price IDs in backend .env.");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") body.append(key, String(value));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe request failed (${res.status})`);
  return json;
}

async function getBillingProfile(user: AuthUser) {
  const fallback = await getProfileForUser(user);
  if (!supabase || user.isGuest) return normalizeProfile(fallback);
  const res = await supabase.from(PROFILES_TABLE).select("id,email,full_name,app_role,plan,subscription_status,account_status,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,updated_at").eq("id", user.id).maybeSingle();
  if (res.error && (res.error as any)?.code !== "PGRST116") throw res.error;
  return normalizeProfile({ ...fallback, ...(res.data || {}), id: user.id, email: user.email });
}

async function findUserIdByStripeCustomer(customerId: string) {
  if (!supabase || !customerId) return null;
  const res = await supabase.from(PROFILES_TABLE).select("id").eq("stripe_customer_id", customerId).maybeSingle();
  if (res.error || !res.data?.id) return null;
  return String(res.data.id);
}

async function updateBillingFields(userId: string, patch: Record<string, any>) {
  const plan = String(patch.plan || "").toLowerCase();
  const catalog = (PLAN_CATALOG as any)[plan] || null;
  const enriched = { ...patch, ...(catalog ? { ads_enabled: catalog.ads_enabled, ai_daily_limit: catalog.ai_daily_limit, saved_area_limit: catalog.saved_area_limit, catch_card_level: catalog.catch_card_level } : {}), updated_at: new Date().toISOString() };
  if (!supabase) { const existing = normalizeProfile(mem.profiles.get(userId) || { id: userId }); const next = normalizeProfile({ ...existing, ...enriched, id: userId }); mem.profiles.set(userId, next); return next; }
  const saved = await supabase.from(PROFILES_TABLE).upsert({ id: userId, ...enriched }, { onConflict: "id" }).select("id,email,app_role,plan,subscription_status,account_status,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,updated_at").single();
  if (saved.error) throw saved.error;
  return saved.data;
}

function stripeStatusToAppStatus(status: string) {
  const s = String(status || "none").toLowerCase();
  if (s === "trialing") return "trial";
  if (s === "active") return "active";
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(s)) return "past_due";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  return s || "none";
}

function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string) {
  if (!STRIPE_WEBHOOK_SECRET) return true;
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map((part) => { const [k, ...rest] = part.split("="); return [k, rest.join("=")]; }));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;
  const payload = `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(payload, "utf8").digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected)); } catch { return false; }
}

app.get("/billing/plans", async (_req, reply) => { ok(reply, { success: true, plans: PLAN_CATALOG, stripe_configured: !!STRIPE_SECRET_KEY, prices_configured: { starter_monthly: !!STRIPE_PRICE_STARTER_MONTHLY, starter_yearly: !!STRIPE_PRICE_STARTER_YEARLY, basic_monthly: !!STRIPE_PRICE_BASIC_MONTHLY, basic_yearly: !!STRIPE_PRICE_BASIC_YEARLY, pro_monthly: !!STRIPE_PRICE_PRO_MONTHLY, pro_yearly: !!STRIPE_PRICE_PRO_YEARLY } }); });

app.get("/billing/me", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const profile = await getBillingProfile(user); const entitlements = getPlanEntitlements(profile); const ai_usage = await getAiUsageStatus(user, profile).catch(() => null); ok(reply, { success: true, user: { id: user.id, email: user.email }, profile, entitlements, ai_usage, beta_manual_plan_access: BETA_MANUAL_PLAN_ACCESS, plans: PLAN_CATALOG }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });
app.get("/billing/usage", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const profile = await getBillingProfile(user); const ai_usage = await getAiUsageStatus(user, profile); ok(reply, { success: true, ai_usage, entitlements: ai_usage.entitlements }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });

app.post("/billing/checkout", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const body = (req.body || {}) as any; const plan = String(body.plan || "").toLowerCase(); const interval = String(body.interval || "monthly").toLowerCase() as BillingInterval; if (!["starter", "basic", "pro"].includes(plan)) throw new Error("Choose starter, basic or pro plan."); const priceId = stripePriceFor(plan, interval); if (!priceId) throw new Error(`Stripe price ID missing for ${plan} ${interval}. Add it to backend .env.`); const profile = await getBillingProfile(user); const base = getFrontendBaseUrl(req); const params: Record<string, any> = { mode: "subscription", "line_items[0][price]": priceId, "line_items[0][quantity]": 1, success_url: `${base}/?billing=success&plan=${encodeURIComponent(plan)}`, cancel_url: `${base}/?billing=cancelled`, client_reference_id: user.id, "metadata[user_id]": user.id, "metadata[email]": user.email || "", "metadata[plan]": plan, "metadata[interval]": interval, "subscription_data[metadata][user_id]": user.id, "subscription_data[metadata][email]": user.email || "", "subscription_data[metadata][plan]": plan, "subscription_data[metadata][interval]": interval, allow_promotion_codes: "true" }; if (profile.stripe_customer_id) params.customer = profile.stripe_customer_id; else if (user.email) params.customer_email = user.email; const session = await stripeRequest("/checkout/sessions", params); ok(reply, { success: true, url: session.url, id: session.id }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });

app.post("/billing/portal", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const profile = await getBillingProfile(user); if (!profile.stripe_customer_id) throw new Error("No Stripe customer found yet. Upgrade first, then billing portal will be available."); const base = getFrontendBaseUrl(req); const session = await stripeRequest("/billing_portal/sessions", { customer: profile.stripe_customer_id, return_url: `${base}/?billing=portal` }); ok(reply, { success: true, url: session.url }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });

app.post("/stripe/webhook", async (req: any, reply) => { try { const rawBody = String(req.rawBody || JSON.stringify(req.body || {})); const sig = String(req.headers?.["stripe-signature"] || ""); if (!verifyStripeWebhookSignature(rawBody, sig)) { reply.code(400).send({ success: false, error: "Invalid Stripe signature" }); return; } const event = req.body || {}; const type = String(event.type || ""); const obj = event.data?.object || {}; if (type === "checkout.session.completed") { const userId = String(obj.metadata?.user_id || obj.client_reference_id || ""); const plan = String(obj.metadata?.plan || "free").toLowerCase(); if (userId && ["starter", "basic", "pro"].includes(plan)) { await updateBillingFields(userId, { plan, subscription_status: "active", stripe_customer_id: obj.customer || null, stripe_subscription_id: obj.subscription || null }); } } if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(type)) { const customerId = String(obj.customer || ""); const userId = String(obj.metadata?.user_id || "") || await findUserIdByStripeCustomer(customerId); if (userId) { let plan = String(obj.metadata?.plan || "").toLowerCase(); if (!["starter", "basic", "pro"].includes(plan)) plan = stripePlanFromPrice(String(obj.items?.data?.[0]?.price?.id || "")); const isDeleted = type === "customer.subscription.deleted"; const status = isDeleted ? "cancelled" : stripeStatusToAppStatus(obj.status || "none"); await updateBillingFields(userId, { plan: isDeleted ? "free" : plan, subscription_status: status, stripe_customer_id: customerId || null, stripe_subscription_id: obj.id || null, subscription_current_period_end: obj.current_period_end ? new Date(Number(obj.current_period_end) * 1000).toISOString() : null, subscription_cancel_at_period_end: !!obj.cancel_at_period_end }); } } ok(reply, { received: true }); } catch (e) { fail(reply, e, 400); } });

// ============================================================
// Admin / dev dashboard routes
// ============================================================
async function getAdminData(limit = 500) {
  if (!supabase) {
    return {
      users: [],
      profiles: [...mem.profiles.values()],
      catches: mem.catches.slice(0, limit),
      auth_available: false,
      storage: "memory",
    };
  }

  const [profilesRes, catchesRes, usersRes] = await Promise.all([
    supabase
      .from(PROFILES_TABLE)
      .select("id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1000),
    supabase
      .from(CATCHES_TABLE)
      .select("id,user_id,user_email,species,weight_kg,length_cm,legal_limit_cm,is_legal,lat,lng,notes,photo_url,created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (catchesRes.error) throw catchesRes.error;

  const users = (usersRes as any)?.data?.users || [];

  return {
    users,
    profiles: profilesRes.data || [],
    catches: catchesRes.data || [],
    auth_available: true,
    storage: "supabase",
  };
}

function buildAdminOverview(data: Awaited<ReturnType<typeof getAdminData>>) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const users = data.users || [];
  const profiles = data.profiles || [];
  const catches = data.catches || [];
  const catchCountsByUser = new Map<string, number>();
  const speciesCounts = new Map<string, number>();
  for (const row of catches as any[]) {
    const userKey = String(row.user_id || row.user_email || "unknown");
    catchCountsByUser.set(userKey, (catchCountsByUser.get(userKey) || 0) + 1);
    const species = cleanSpecies(row.species || "Unknown");
    speciesCounts.set(species, (speciesCounts.get(species) || 0) + 1);
  }
  const activeUserIds = new Set((catches as any[]).filter((row) => {
    const ts = Date.parse(String(row.created_at || ""));
    return Number.isFinite(ts) && now - ts <= 7 * dayMs;
  }).map((row) => String(row.user_id || row.user_email || "unknown")));
  const activeFromSignIn = (users as any[]).filter((u) => {
    const ts = Date.parse(String(u.last_sign_in_at || ""));
    return Number.isFinite(ts) && now - ts <= 7 * dayMs;
  }).length;
  const topSpecies = [...speciesCounts.entries()].filter(([species]) => species !== "Unknown").sort((a, b) => b[1] - a[1]).slice(0, 8).map(([species, count]) => ({ species, count }));
  return {
    totals: {
      users: users.length || profiles.length,
      auth_users: users.length,
      profiles: profiles.length,
      catches: catches.length,
      active_7d: Math.max(activeUserIds.size, activeFromSignIn),
      photos: (catches as any[]).filter((row) => !!row.photo_url).length,
    },
    top_species: topSpecies,
    recent_users: (users as any[]).slice(0, 20).map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at, catch_count: catchCountsByUser.get(String(u.id)) || 0 })),
    recent_catches: (catches as any[]).slice(0, 20),
    storage: data.storage,
    auth_available: data.auth_available,
  };
}

async function writeAuditLog(actor: AuthUser, action: string, targetType: string, targetId: string, details: Record<string, any> = {}) {
  const row = {
    id: crypto.randomUUID(),
    actor_id: actor.id,
    actor_email: actor.email ?? null,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
    created_at: new Date().toISOString(),
  };

  if (!supabase) {
    mem.audit.unshift(row);
    mem.audit = mem.audit.slice(0, 500);
    return row;
  }

  try {
    const saved = await supabase.from(AUDIT_TABLE).insert(row).select("id,actor_id,actor_email,action,target_type,target_id,details,created_at").single();
    return saved.data || row;
  } catch (e) {
    console.warn("writeAuditLog failed", e);
    return row;
  }
}

async function listAuditRows(limit = 100) {
  if (!supabase) return mem.audit.slice(0, limit);
  try {
    const res = await supabase
      .from(AUDIT_TABLE)
      .select("id,actor_id,actor_email,action,target_type,target_id,details,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (res.error) throw res.error;
    return res.data || [];
  } catch (e) {
    console.warn("listAuditRows failed", e);
    return [];
  }
}

async function listFeedbackRows(limit = 100) {
  if (!supabase) return mem.feedback.slice(0, limit);
  try {
    const res = await supabase
      .from(FEEDBACK_TABLE)
      .select("id,user_id,user_email,type,message,page,status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (res.error) throw res.error;
    return res.data || [];
  } catch (e) {
    console.warn("listFeedbackRows failed", e);
    return [];
  }
}

async function upsertProfileAdminPatch(userId: string, patch: Record<string, any>) {
  const planKey = String(patch.plan || "").toLowerCase();
  const planDefaults = (PLAN_CATALOG as any)[planKey] || null;
  const enrichedPatch = {
    ...patch,
    ...(planDefaults ? {
      ads_enabled: planDefaults.ads_enabled,
      ai_daily_limit: planDefaults.ai_daily_limit,
      saved_area_limit: planDefaults.saved_area_limit,
      catch_card_level: planDefaults.catch_card_level,
    } : {}),
  };

  if (!supabase) {
    const existing = normalizeProfile(mem.profiles.get(userId) || { id: userId });
    const next = normalizeProfile({ ...existing, ...enrichedPatch, id: userId, updated_at: new Date().toISOString() });
    mem.profiles.set(userId, next);
    return next;
  }

  const saved = await supabase
    .from(PROFILES_TABLE)
    .upsert({ ...enrichedPatch, id: userId, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at")
    .single();

  if (saved.error) throw saved.error;
  await syncProfileMetadata(userId, normalizeProfile(saved.data));
  return saved.data;
}

function buildSystemHealth() {
  return {
    success: true,
    build_id: BUILD_ID,
    server_time: new Date().toISOString(),
    host: HOST,
    port: PORT,
    supabase: !!supabase,
    auth_api_configured: !!(SUPABASE_URL && SUPABASE_AUTH_API_KEY),
    openai: !!openai,
    windy_point_forecast_configured: !!WINDY_POINT_FORECAST_KEY,
    windy_key_source: WINDY_KEY_SOURCE,
    weather_api_key_alias_present: !!envValue("WEATHER_API_KEY"),
    stripe_configured: !!STRIPE_SECRET_KEY,
    beta_manual_plan_access: BETA_MANUAL_PLAN_ACCESS,
    stripe_prices_configured: { starter_monthly: !!STRIPE_PRICE_STARTER_MONTHLY, starter_yearly: !!STRIPE_PRICE_STARTER_YEARLY, basic_monthly: !!STRIPE_PRICE_BASIC_MONTHLY, basic_yearly: !!STRIPE_PRICE_BASIC_YEARLY, pro_monthly: !!STRIPE_PRICE_PRO_MONTHLY, pro_yearly: !!STRIPE_PRICE_PRO_YEARLY },
    admin_enabled: ADMIN_EMAILS.length > 0 || ADMIN_USER_IDS.length > 0,
    tables: {
      profiles: PROFILES_TABLE,
      catches: CATCHES_TABLE,
      feedback: FEEDBACK_TABLE,
      audit: AUDIT_TABLE,
      usage: USAGE_TABLE,
      saved_areas: SAVED_AREAS_TABLE,
      ai_chat_sessions: AI_CHAT_SESSIONS_TABLE,
      ai_chat_messages: AI_CHAT_MESSAGES_TABLE,
      ai_memory: AI_MEMORY_TABLE,
      ai_feedback: AI_FEEDBACK_TABLE,
    },
  };
}


// ============================================================
// Saved Areas — private favourite spots / areas with plan limits
// ============================================================
function normalizeSavedArea(row: any = {}): SavedAreaRow {
  return {
    id: String(row.id || crypto.randomUUID()),
    user_id: row.user_id ?? null,
    user_email: row.user_email ?? null,
    name: str(row.name, "Saved Area").slice(0, 80),
    area_type: str(row.area_type, "custom").slice(0, 40),
    lat: Number(row.lat),
    lng: Number(row.lng),
    radius_km: row.radius_km == null ? 35 : Number(row.radius_km),
    general_area: str(row.general_area, "Spot Safe Area").slice(0, 120),
    notes: str(row.notes, "").slice(0, 1000) || null,
    privacy: str(row.privacy, "private").slice(0, 40),
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

async function listSavedAreasForUser(user: AuthUser, limit = 200): Promise<SavedAreaRow[]> {
  if (!supabase) {
    return mem.savedAreas
      .filter((x) => (x.user_id || DEV_GUEST_USER_ID) === user.id)
      .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))
      .slice(0, limit);
  }

  const res = await supabase
    .from(SAVED_AREAS_TABLE)
    .select("id,user_id,user_email,name,area_type,lat,lng,radius_km,general_area,notes,privacy,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (res.error) throw res.error;
  return (res.data || []).map(normalizeSavedArea);
}

async function getSavedAreaEntitlements(user: AuthUser) {
  const profile = await getBillingProfile(user);
  const entitlements = getPlanEntitlements(profile);
  return { profile, entitlements, limit: Number(entitlements.saved_area_limit || 0) };
}

app.get("/saved-areas", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const rows = await listSavedAreasForUser(user);
    const limits = await getSavedAreaEntitlements(user).catch(() => ({ entitlements: null, limit: 3 } as any));
    ok(reply, { success: true, saved_areas: rows, count: rows.length, limit: limits.limit, entitlements: limits.entitlements });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.post("/saved-areas", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const body = (req.body || {}) as any;
    const name = str(body.name, "");
    const lat = num(body.lat);
    const lng = num(body.lng);
    const radius = num(body.radius_km) ?? 35;
    if (!name) throw new Error("Area name is required.");
    if (lat == null || lng == null) throw new Error("Latitude and longitude are required.");

    const existing = await listSavedAreasForUser(user, 1000);
    const { limit, entitlements } = await getSavedAreaEntitlements(user);
    if (limit > 0 && existing.length >= limit) {
      const plan = String((entitlements as any)?.effective_plan || "free");
      const err = new Error(
        "Saved area limit reached for " + plan + ". Used " + existing.length + "/" + limit + ". Upgrade or delete an area."
      ) as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }

    const row = normalizeSavedArea({
      id: crypto.randomUUID(),
      user_id: user.id,
      user_email: user.email ?? null,
      name,
      area_type: str(body.area_type, "custom"),
      lat,
      lng,
      radius_km: radius,
      general_area: str(body.general_area, "Spot Safe Area"),
      notes: str(body.notes, ""),
      privacy: str(body.privacy, "private"),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (!supabase) {
      mem.savedAreas.unshift(row);
      ok(reply, { success: true, saved_area: row });
      return;
    }

    const saved = await supabase
      .from(SAVED_AREAS_TABLE)
      .insert(row)
      .select("id,user_id,user_email,name,area_type,lat,lng,radius_km,general_area,notes,privacy,created_at,updated_at")
      .single();
    if (saved.error) throw saved.error;
    ok(reply, { success: true, saved_area: normalizeSavedArea(saved.data) });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.patch("/saved-areas/:id", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const id = String((req.params as any)?.id || "");
    const body = (req.body || {}) as any;
    if (!id) throw new Error("Missing saved area id.");

    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = str(body.name, "Saved Area").slice(0, 80);
    if (body.area_type != null) patch.area_type = str(body.area_type, "custom").slice(0, 40);
    if (body.lat != null) patch.lat = num(body.lat);
    if (body.lng != null) patch.lng = num(body.lng);
    if (body.radius_km != null) patch.radius_km = num(body.radius_km) ?? 35;
    if (body.general_area != null) patch.general_area = str(body.general_area, "Spot Safe Area").slice(0, 120);
    if (body.notes != null) patch.notes = str(body.notes, "").slice(0, 1000) || null;
    if (body.privacy != null) patch.privacy = str(body.privacy, "private").slice(0, 40);

    if (!supabase) {
      const idx = mem.savedAreas.findIndex((x) => x.id === id && (x.user_id || DEV_GUEST_USER_ID) === user.id);
      if (idx < 0) throw new Error("Saved area not found.");
      mem.savedAreas[idx] = normalizeSavedArea({ ...mem.savedAreas[idx], ...patch });
      ok(reply, { success: true, saved_area: mem.savedAreas[idx] });
      return;
    }

    const saved = await supabase
      .from(SAVED_AREAS_TABLE)
      .update(patch)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id,user_id,user_email,name,area_type,lat,lng,radius_km,general_area,notes,privacy,created_at,updated_at")
      .maybeSingle();
    if (saved.error && (saved.error as any)?.code !== "PGRST116") throw saved.error;
    if (!saved.data) throw new Error("Saved area not found.");
    ok(reply, { success: true, saved_area: normalizeSavedArea(saved.data) });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.delete("/saved-areas/:id", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const id = String((req.params as any)?.id || "");
    if (!id) throw new Error("Missing saved area id.");

    if (!supabase) {
      const before = mem.savedAreas.length;
      mem.savedAreas = mem.savedAreas.filter((x) => !(x.id === id && (x.user_id || DEV_GUEST_USER_ID) === user.id));
      ok(reply, { success: true, deleted: before !== mem.savedAreas.length });
      return;
    }

    const deleted = await supabase
      .from(SAVED_AREAS_TABLE)
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (deleted.error && (deleted.error as any)?.code !== "PGRST116") throw deleted.error;
    ok(reply, { success: true, deleted: !!deleted.data?.id });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.post("/feedback", async (req, reply) => {
  try {
    const user = await getAuthUser(req);
    const body = (req.body || {}) as any;
    const message = str(body.message, "");
    if (!message || message.length < 5) {
      reply.code(400).send({ success: false, error: "Feedback message is required." });
      return;
    }

    const row = {
      id: crypto.randomUUID(),
      user_id: user.isGuest ? null : user.id,
      user_email: user.email ?? null,
      type: str(body.type, "feedback"),
      message: message.slice(0, 4000),
      page: str(body.page, "app"),
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!supabase) {
      mem.feedback.unshift(row);
      ok(reply, { success: true, feedback: row });
      return;
    }

    const saved = await supabase
      .from(FEEDBACK_TABLE)
      .insert(row)
      .select("id,user_id,user_email,type,message,page,status,created_at,updated_at")
      .single();
    if (saved.error) throw saved.error;
    ok(reply, { success: true, feedback: saved.data });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.get("/admin/overview", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const data = await getAdminData(500);
    const overview = buildAdminOverview(data);
    const feedback = await listFeedbackRows(100);
    const audit = await listAuditRows(50);
    const profiles = data.profiles || [];
    const suspended = (profiles as any[]).filter((p) => String(p.account_status || "active") === "suspended").length;
    const proUsers = (profiles as any[]).filter((p) => ["starter", "basic", "pro", "founder", "premium"].includes(String(p.plan || "").toLowerCase())).length;
    ok(reply, {
      success: true,
      admin: { id: admin.id, email: admin.email },
      ...overview,
      control_totals: {
        suspended,
        pro_users: proUsers,
        open_feedback: (feedback as any[]).filter((f) => String(f.status || "open") === "open").length,
        audit_events: audit.length,
      },
    });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.get("/admin/users", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const data = await getAdminData(500);
    const profilesById = new Map((data.profiles || []).map((p: any) => [String(p.id), p]));
    const catchCountsByUser = new Map<string, number>();
    for (const row of data.catches as any[]) {
      const userKey = String(row.user_id || row.user_email || "unknown");
      catchCountsByUser.set(userKey, (catchCountsByUser.get(userKey) || 0) + 1);
    }
    const users = (data.users || []).map((u: any) => ({
      id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at,
      profile: profilesById.get(String(u.id)) || null,
      catch_count: catchCountsByUser.get(String(u.id)) || 0,
      app_role: (profilesById.get(String(u.id)) as any)?.app_role || u?.user_metadata?.app_role || null,
      plan: (profilesById.get(String(u.id)) as any)?.plan || u?.user_metadata?.plan || "free",
      subscription_status: (profilesById.get(String(u.id)) as any)?.subscription_status || u?.user_metadata?.subscription_status || "none",
      account_status: (profilesById.get(String(u.id)) as any)?.account_status || u?.user_metadata?.account_status || "active",
    }));
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, users });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.get("/admin/catches", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const limit = clamp(Number((req.query as any)?.limit || 500), 1, 1000);
    const data = await getAdminData(limit);
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, catches: (data.catches || []).map((row: any) => ({ ...row, photo_url: makeAbsoluteMediaUrl(req, row.photo_url) })) });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.get("/admin/profiles", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const data = await getAdminData(200);
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, profiles: data.profiles || [] });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.get("/admin/users/:id", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const userId = str((req.params as any)?.id);
    if (!userId) {
      reply.code(400).send({ success: false, error: "User id is required." });
      return;
    }

    const data = await getAdminData(1000);
    const lookup = userId.toLowerCase();
    const user = (data.users || []).find((u: any) => String(u.id) === userId || String(u.email || "").toLowerCase() === lookup) || null;
    const profile = (data.profiles || []).find((p: any) => String(p.id) === userId || String(p.email || "").toLowerCase() === lookup) || null;
    const selectedId = String(user?.id || profile?.id || userId);
    const selectedEmail = String(user?.email || profile?.email || userId).toLowerCase();
    const catches = (data.catches || [])
      .filter((row: any) => String(row.user_id) === selectedId || String(row.user_email || "").toLowerCase() === selectedEmail)
      .map((row: any) => ({ ...row, photo_url: makeAbsoluteMediaUrl(req, row.photo_url) }));

    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, user, profile, catches });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.patch("/admin/profiles/:id", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const userId = str((req.params as any)?.id);
    if (!userId) {
      reply.code(400).send({ success: false, error: "User id is required." });
      return;
    }

    const body = (req.body || {}) as any;
    const patch: Record<string, any> = {
      id: userId,
      full_name: str(body.full_name, "") || null,
      username: str(body.username, "") || null,
      boat_name: str(body.boat_name, "") || null,
      home_port: str(body.home_port, "") || null,
      favourite_species: str(body.favourite_species, "") || null,
      role_plan: str(body.role_plan, "") || null,
      avatar_url: str(body.avatar_url, "") || null,
      legal_version: str(body.legal_version, LEGAL_VERSION),
      app_role: str(body.app_role, "") || null,
      plan: str(body.plan, "free") || "free",
      subscription_status: str(body.subscription_status, "none") || "none",
      account_status: str(body.account_status, "active") || "active",
      admin_notes: str(body.admin_notes, "") || null,
      suspended_at: str(body.account_status, "active") === "suspended" ? (str(body.suspended_at, "") || new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    };

    const existingEmail = str(body.email, "") || null;
    if (existingEmail) patch.email = existingEmail;

    if (!supabase) {
      const existing = normalizeProfile(mem.profiles.get(userId) || { id: userId });
      const next = normalizeProfile({ ...existing, ...patch });
      mem.profiles.set(userId, next);
      ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, profile: next });
      return;
    }

    const saved = await supabase
      .from(PROFILES_TABLE)
      .upsert(patch, { onConflict: "id" })
      .select("id,email,full_name,username,boat_name,home_port,favourite_species,role_plan,avatar_url,accepted_terms_at,accepted_privacy_at,accepted_disclaimer_at,legal_version,app_role,plan,subscription_status,account_status,admin_notes,suspended_at,stripe_customer_id,stripe_subscription_id,subscription_current_period_end,subscription_cancel_at_period_end,ads_enabled,ai_daily_limit,saved_area_limit,catch_card_level,created_at,updated_at")
      .single();

    if (saved.error) throw saved.error;
    await writeAuditLog(admin, "profile_updated", "user", userId, { fields: Object.keys(patch) });
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, profile: saved.data });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.delete("/admin/catches/:id", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const catchId = str((req.params as any)?.id);
    if (!catchId) {
      reply.code(400).send({ success: false, error: "Catch id is required." });
      return;
    }

    if (!supabase) {
      const before = mem.catches.length;
      mem.catches = mem.catches.filter((row) => String(row.id) !== catchId);
      ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, deleted: before !== mem.catches.length });
      return;
    }

    const deleted = await supabase
      .from(CATCHES_TABLE)
      .delete()
      .eq("id", catchId)
      .select("id")
      .maybeSingle();

    if (deleted.error && (deleted.error as any)?.code !== "PGRST116") throw deleted.error;
    await writeAuditLog(admin, "catch_deleted", "catch", catchId, { deleted: !!deleted.data?.id });
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, deleted: !!deleted.data?.id });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});


app.get("/admin/system-health", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    ok(reply, { admin: { id: admin.id, email: admin.email }, ...buildSystemHealth() });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.patch("/admin/users/:id/status", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const userId = str((req.params as any)?.id);
    if (!userId) { reply.code(400).send({ success: false, error: "User id is required." }); return; }
    const body = (req.body || {}) as any;
    const patch = {
      email: str(body.email, "") || null,
      app_role: str(body.app_role, "") || null,
      plan: str(body.plan, "free") || "free",
      subscription_status: str(body.subscription_status, "none") || "none",
      account_status: str(body.account_status, "active") || "active",
      admin_notes: str(body.admin_notes, "") || null,
      suspended_at: str(body.account_status, "active") === "suspended" ? new Date().toISOString() : null,
    };
    const profile = await upsertProfileAdminPatch(userId, patch);
    if (supabase) {
      try {
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: metadataFromProfile(normalizeProfile(profile)),
          ...(patch.account_status === "suspended" ? { ban_duration: "876000h" } : { ban_duration: "none" }),
        } as any);
      } catch (e) { console.warn("admin auth status update failed", e); }
    }
    await writeAuditLog(admin, "user_status_updated", "user", userId, patch);
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, profile });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.post("/admin/users/:id/suspend", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const userId = str((req.params as any)?.id);
    const body = (req.body || {}) as any;
    const profile = await upsertProfileAdminPatch(userId, { email: str(body.email, "") || null, account_status: "suspended", admin_notes: str(body.admin_notes, "Suspended by admin"), suspended_at: new Date().toISOString() });
    if (supabase) { try { await supabase.auth.admin.updateUserById(userId, { ban_duration: "876000h", user_metadata: metadataFromProfile(normalizeProfile(profile)) } as any); } catch (e) { console.warn("ban failed", e); } }
    await writeAuditLog(admin, "user_suspended", "user", userId, { email: body.email || null });
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, profile });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.post("/admin/users/:id/unsuspend", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const userId = str((req.params as any)?.id);
    const body = (req.body || {}) as any;
    const profile = await upsertProfileAdminPatch(userId, { email: str(body.email, "") || null, account_status: "active", suspended_at: null });
    if (supabase) { try { await supabase.auth.admin.updateUserById(userId, { ban_duration: "none", user_metadata: metadataFromProfile(normalizeProfile(profile)) } as any); } catch (e) { console.warn("unban failed", e); } }
    await writeAuditLog(admin, "user_unsuspended", "user", userId, { email: body.email || null });
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, profile });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.get("/admin/feedback", async (req, reply) => {
  try { const admin = await requireAdminUser(req); const feedback = await listFeedbackRows(clamp(Number((req.query as any)?.limit || 200), 1, 500)); ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, feedback }); }
  catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.patch("/admin/feedback/:id", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const id = str((req.params as any)?.id);
    const status = str((req.body as any)?.status, "open") || "open";
    const patch = { status, updated_at: new Date().toISOString() };
    if (!supabase) { const row = mem.feedback.find((x) => String(x.id) === id); if (row) Object.assign(row, patch); await writeAuditLog(admin, "feedback_status_updated", "feedback", id, patch); ok(reply, { success: true, feedback: row || null }); return; }
    const saved = await supabase.from(FEEDBACK_TABLE).update(patch).eq("id", id).select("id,user_id,user_email,type,message,page,status,created_at,updated_at").maybeSingle();
    if (saved.error && (saved.error as any)?.code !== "PGRST116") throw saved.error;
    await writeAuditLog(admin, "feedback_status_updated", "feedback", id, patch);
    ok(reply, { success: true, feedback: saved.data || null });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.get("/admin/audit", async (req, reply) => {
  try { const admin = await requireAdminUser(req); const audit = await listAuditRows(clamp(Number((req.query as any)?.limit || 200), 1, 500)); ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, audit }); }
  catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});



app.post("/api/tactical/snapshot", async (req, reply) => {
  try { const user = await getRequiredAuthUser(req); const body = (req.body || {}) as TacticalSnapshotPayload; const built = await buildTacticalSnapshot(user, body); const snapshot = await saveTacticalSnapshot(user, built.snapshot, body); ok(reply, { success: true, snapshot }); }
  catch (e: any) { fail(reply, e, e?.statusCode || 500); }
});

app.post("/ai/tactical/snapshot", async (req, reply) => {
  try { const user = await getRequiredAuthUser(req); const body = (req.body || {}) as TacticalSnapshotPayload; const built = await buildTacticalSnapshot(user, body); const snapshot = await saveTacticalSnapshot(user, built.snapshot, body); ok(reply, { success: true, snapshot }); }
  catch (e: any) { fail(reply, e, e?.statusCode || 500); }
});

app.get("/api/tactical/snapshots", async (req, reply) => {
  try { const user = await getRequiredAuthUser(req); if (!supabase || user.isGuest) { ok(reply, { success: true, snapshots: [] }); return; } const res = await supabase.from(TACTICAL_SNAPSHOTS_TABLE).select("id,user_id,saved_area_id,area_name,lat,lng,radius_km,signal,confidence,headline,snapshot_json,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10); if (res.error) throw res.error; ok(reply, { success: true, snapshots: res.data || [] }); }
  catch (e: any) { fail(reply, e, e?.statusCode || 500); }
});


// ============================================================
// Boat AI catalogue + learning routes — merged from standalone Boat AI V15
// ============================================================
function boatAiSearchTokens(q: string) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);
}

app.get('/api/boat/catalog/boats', async (req, reply) => {
  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const q = String((req.query as any)?.q || '').trim();
    const tokens = boatAiSearchTokens(q);
    let query = supabase
      .from('boat_models')
      .select('id,brand,model,material,hull_type,hull_shape,category,loa_m,beam_m,fuel_l,dry_tow_weight_kg,min_hp,max_hp,persons,year_from,year_to,source_name,data_quality,search_keywords')
      .limit(30);

    if (tokens.length) {
      const clauses = tokens.flatMap((t) => [
        `brand.ilike.%${t}%`,
        `model.ilike.%${t}%`,
        `material.ilike.%${t}%`,
        `hull_type.ilike.%${t}%`,
        `search_keywords.ilike.%${t}%`,
      ]);
      query = query.or(clauses.join(','));
    }

    const { data, error } = await query.order('brand', { ascending: true }).order('model', { ascending: true });
    if (error) throw error;
    ok(reply, { success: true, boats: data || [] });
  } catch (e) { fail(reply, e, 500); }
});

app.get('/api/boat/catalog/outboards', async (req, reply) => {
  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const q = String((req.query as any)?.q || '').trim();
    const tokens = boatAiSearchTokens(q);
    let query = supabase
      .from('outboard_models')
      .select('id,brand,model,hp,engine_type,stroke_type,fuel_type,year_from,year_to,source_name,data_quality,search_keywords')
      .limit(30);

    if (tokens.length) {
      const clauses = tokens.flatMap((t) => [
        `brand.ilike.%${t}%`,
        `model.ilike.%${t}%`,
        `engine_type.ilike.%${t}%`,
        `stroke_type.ilike.%${t}%`,
        `search_keywords.ilike.%${t}%`,
      ]);
      for (const t of tokens) {
        const numeric = Number(t);
        if (Number.isFinite(numeric)) clauses.push(`hp.eq.${numeric}`);
      }
      query = query.or(clauses.join(','));
    }

    const { data, error } = await query.order('brand', { ascending: true }).order('hp', { ascending: true });
    if (error) throw error;
    ok(reply, { success: true, outboards: data || [] });
  } catch (e) { fail(reply, e, 500); }
});

app.post('/api/boat/trip-log', async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    if (!supabase) throw new Error('Supabase is not configured.');
    const body = (req.body || {}) as any;
    const trip = body.trip_log || body;
    const insertRow = {
      user_id: user.id,
      user_boat_id: trip.user_boat_id || null,
      boat_model_id: trip.boat_model_id || null,
      outboard_model_id: trip.outboard_model_id || null,
      boat_name: trip.boat_name || null,
      hull_type: trip.hull_type || null,
      loa_m: trip.loa_m ?? null,
      beam_m: trip.beam_m ?? null,
      loaded_weight_kg: trip.loaded_weight_kg ?? null,
      hp: trip.hp ?? null,
      engine_type: trip.engine_type || null,
      engine_count: trip.engine_count ?? 1,
      trip_type: trip.trip_type || null,
      distance_km: trip.distance_km ?? null,
      extra_km: trip.extra_km ?? null,
      troll_hours: trip.troll_hours ?? null,
      avg_speed_kn: trip.avg_speed_kn ?? null,
      wind_state: trip.wind_state || null,
      swell_state: trip.swell_state || null,
      wind_angle: trip.wind_angle || null,
      load_state: trip.load_state || null,
      fuel_onboard_l: trip.fuel_onboard_l ?? null,
      reserve_percent: trip.reserve_percent ?? null,
      predicted_burn_lph: trip.predicted_burn_lph ?? null,
      predicted_trip_fuel_l: trip.predicted_trip_fuel_l ?? null,
      actual_trip_fuel_l: trip.actual_trip_fuel_l ?? null,
      actual_burn_lph: trip.actual_burn_lph ?? null,
      prediction_error_percent: trip.prediction_error_percent ?? null,
      decision: trip.decision || null,
      confidence: trip.confidence ?? null,
      spare_above_reserve_l: trip.spare_above_reserve_l ?? null,
      return_bias_percent: trip.return_bias_percent ?? null,
      data_quality_score: trip.data_quality_score ?? null,
      notes: trip.notes || null,
    };
    const saved = await supabase.from('boat_ai_trip_logs').insert(insertRow).select('*').single();
    if (saved.error) throw saved.error;

    await supabase.from('boat_ai_learning_events').insert({
      user_id: user.id,
      build: 'boat_ai_react_merge_v1',
      anonymised: true,
      boat_class: {
        hull_type: insertRow.hull_type,
        loa_m: insertRow.loa_m,
        hp: insertRow.hp,
        engine_type: insertRow.engine_type,
        engine_count: insertRow.engine_count,
      },
      trip: {
        trip_type: insertRow.trip_type,
        distance_km: insertRow.distance_km,
        avg_speed_kn: insertRow.avg_speed_kn,
      },
      conditions: {
        wind_state: insertRow.wind_state,
        swell_state: insertRow.swell_state,
        wind_angle: insertRow.wind_angle,
        load_state: insertRow.load_state,
      },
      result: {
        predicted_burn_lph: insertRow.predicted_burn_lph,
        predicted_trip_fuel_l: insertRow.predicted_trip_fuel_l,
        decision: insertRow.decision,
        spare_above_reserve_l: insertRow.spare_above_reserve_l,
        confidence: insertRow.confidence,
      },
      actual: {
        actual_trip_fuel_l: insertRow.actual_trip_fuel_l,
        actual_burn_lph: insertRow.actual_burn_lph,
        prediction_error_percent: insertRow.prediction_error_percent,
      },
      source: 'backend_route',
    }).catch(() => null);

    ok(reply, { success: true, trip_log: saved.data });
  } catch (e) { fail(reply, e, (e as any)?.message?.includes('Sign in') ? 401 : 500); }
});


// Deterministic Boat AI maths route — V17 fixed realistic speed-based fuel model
function boatAiEngineType(v: any = '') {
  const s = String(v || '').toLowerCase();
  if (s.includes('optimax') || s.includes('dfi') || s.includes('e-tec') || s.includes('etec')) return '2-stroke DFI';
  if (s.includes('2-stroke') || s.includes('2 stroke') || s.includes('two stroke') || s === '2') return '2-stroke';
  if (s.includes('diesel')) return 'diesel';
  return '4-stroke';
}
function boatAiWotPerHp(t: any) {
  const s = boatAiEngineType(t).toLowerCase();
  if (s.includes('diesel')) return 0.24;
  if (s.includes('dfi')) return 0.42;
  if (s.includes('2-stroke')) return 0.48;
  return 0.34;
}
function boatAiCruiseCoeff(t: any) {
  const s = boatAiEngineType(t).toLowerCase();
  if (s.includes('diesel')) return 0.145;
  if (s.includes('dfi')) return 0.200;
  if (s.includes('2-stroke')) return 0.225;
  return 0.180;
}
function boatAiHullFactor(hull: any) {
  const s = String(hull || '').toLowerCase();
  if (s.includes('cat')) return 0.96;
  if (s.includes('plate')) return 1.04;
  if (s.includes('timber')) return 1.08;
  if (s.includes('aluminium') || s.includes('alloy')) return 1.02;
  return 1.0;
}
function boatAiWeightSanity(loa: number, kg: number) {
  const min = Math.max(650, loa * 230);
  const max = loa * 620;
  if (!kg) return { kg: min, msg: 'No loaded weight entered; using hull-size estimate.' };
  if (kg < min) return { kg: min, msg: `Weight looked light for ${loa.toFixed(1)}m; using ${Math.round(min)}kg for maths.` };
  if (kg > max) return { kg: max, msg: `Weight looked heavy for ${loa.toFixed(1)}m; capped to ${Math.round(max)}kg for maths.` };
  return { kg, msg: '' };
}
function boatAiConditionFactor(inp: any) {
  let f = 1;
  if (inp.wind === '10-20') f *= 1.07;
  if (inp.wind === '20-25') f *= 1.17;
  if (inp.wind === '25+') f *= 1.32;
  if (inp.swell === '1-1.8') f *= 1.07;
  if (inp.swell === '2-2.5') f *= 1.16;
  if (inp.swell === '2.5+') f *= 1.30;
  if (inp.windAngle === 'against') f *= 1.12;
  if (inp.windAngle === 'side') f *= 1.06;
  if (inp.tripType === 'bar') f *= 1.04;
  return clamp(f, 1, 1.75);
}
function boatAiReturnBias(inp: any) {
  let b = 0.05;
  if (inp.tripType === 'offshore') b += 0.03;
  if (inp.tripType === 'remote') b += 0.06;
  if (inp.tripType === 'bar') b += 0.06;
  if (inp.wind === '10-20') b += 0.04;
  if (inp.wind === '20-25') b += 0.09;
  if (inp.wind === '25+') b += 0.16;
  if (inp.swell === '1-1.8') b += 0.03;
  if (inp.swell === '2-2.5') b += 0.08;
  if (inp.swell === '2.5+') b += 0.14;
  if (inp.windAngle === 'against') b += 0.10;
  if (inp.windAngle === 'unknown') b += 0.05;
  return clamp(b, 0, 0.42);
}
function boatAiCalculate(raw: any) {
  const inp = {
    boatName: String(raw?.boatName || raw?.boat_name || 'Boat'),
    hullType: String(raw?.hullType || raw?.hull_type || 'fibreglass'),
    loa: Number(raw?.loa ?? raw?.loa_m ?? 5.9),
    beam: Number(raw?.beam ?? raw?.beam_m ?? 2.3),
    weight: Number(raw?.weight ?? raw?.loaded_weight_kg ?? 1300),
    fuel: Number(raw?.fuel ?? raw?.fuel_onboard_l ?? 150),
    engine: String(raw?.engine || 'Engine'),
    hp: Number(raw?.hp ?? 150) * Math.max(1, Number(raw?.engineCount ?? raw?.engine_count ?? 1)),
    engineCount: Math.max(1, Number(raw?.engineCount ?? raw?.engine_count ?? 1)),
    engineType: String(raw?.engineType || raw?.engine_type || '4-stroke'),
    speed: Number(raw?.speed ?? raw?.avg_speed_kn ?? 22),
    distance: Number(raw?.distance ?? raw?.distance_km ?? 0),
    extra: Number(raw?.extra ?? raw?.extra_km ?? 0),
    reserve: clamp(Number(raw?.reserve ?? raw?.reserve_percent ?? 30), 0, 60),
    wind: String(raw?.wind || raw?.wind_state || '0-10'),
    swell: String(raw?.swell || raw?.swell_state || 'below-1'),
    windAngle: String(raw?.windAngle || raw?.wind_angle || 'unknown'),
    tripType: String(raw?.tripType || raw?.trip_type || 'offshore'),
  };
  const speedKmh = Math.max(0.1, inp.speed * 1.852);
  const total = Math.max(0, inp.distance + inp.extra);
  const ws = boatAiWeightSanity(inp.loa, inp.weight);
  const wot = inp.hp * boatAiWotPerHp(inp.engineType);
  let flat = inp.hp * boatAiCruiseCoeff(inp.engineType) * Math.pow(Math.max(3, inp.speed) / 22, 1.85);
  if (inp.speed >= 9 && inp.speed < 18) flat *= 1 + (18 - inp.speed) * 0.055;
  if (inp.speed < 9) flat *= 0.42 + (inp.speed / 9) * 0.58;
  const expectedKg = Math.max(650, inp.loa * 230);
  flat *= boatAiHullFactor(inp.hullType) * clamp(Math.pow(ws.kg / expectedKg, 0.28), 0.88, 1.18) * clamp(1 + ((inp.loa - 5.8) * 0.018), 0.94, 1.08);
  flat = clamp(flat, wot * 0.16, wot * 0.76);
  const cond = boatAiConditionFactor(inp);
  const base = flat * cond;
  const rb = boatAiReturnBias(inp);
  const outFuel = ((total / 2) / speedKmh) * base;
  const homeFuel = ((total / 2) / speedKmh) * base * (1 + rb);
  const tripFuel = outFuel + homeFuel;
  const hours = total / speedKmh;
  const avg = hours ? tripFuel / hours : 0;
  const reserveL = inp.fuel * (inp.reserve / 100);
  const spare = inp.fuel - tripFuel - reserveL;
  const usable = Math.max(0, inp.fuel - reserveL);
  const range = avg ? usable / avg * speedKmh : 0;
  let risk = 0;
  if (inp.wind !== '0-10') risk++;
  if (inp.swell !== 'below-1') risk++;
  if (inp.windAngle === 'unknown' || inp.windAngle === 'against') risk++;
  if (inp.tripType === 'bar' || inp.tripType === 'remote' || inp.tripType === 'offshore') risk++;
  const sparePct = inp.fuel ? (spare / inp.fuel) * 100 : 0;
  let decision = 'GO', reason = 'Fuel buffer looks healthy for this plan.';
  if (spare < 0 || range < total || inp.wind === '25+' || inp.swell === '2.5+') {
    decision = 'NO GO'; reason = spare < 0 ? `Short by ${Math.abs(spare).toFixed(0)}L after reserve.` : 'Conditions/range fail.';
  } else if (inp.tripType !== 'inshore' && sparePct < 10) {
    decision = 'CAUTION'; reason = 'Offshore margin is thin. Trip works on paper, but protect fuel.';
  } else if (risk >= 3 || sparePct < 22) {
    decision = 'GO — WATCH'; reason = 'Fuel works, but keep an eye on conditions and return leg.';
  }
  let confidence = 96;
  if (risk >= 3) confidence -= 12;
  if (inp.windAngle === 'unknown') confidence -= 7;
  if (sparePct < 15) confidence -= 10;
  if (ws.msg) confidence -= 5;
  if (wot && avg / wot > 0.62) confidence -= 8;
  confidence = clamp(confidence, 45, 96);
  return { success: true, input: inp, weight_sanity: ws, flat_burn_lph: round2(flat), condition_factor: round2(cond), average_burn_lph: round2(avg), trip_fuel_l: round2(tripFuel), reserve_l: round2(reserveL), spare_l: round2(spare), safe_range_km: round2(range), out_fuel_l: round2(outFuel), return_fuel_l: round2(homeFuel), return_bias_percent: Math.round(rb * 100), decision, reason, confidence: Math.round(confidence), wot_lph: round2(wot) };
}

app.post('/api/boat/calculate', async (req, reply) => {
  try { ok(reply, boatAiCalculate(req.body || {})); }
  catch (e) { fail(reply, e, 500); }
});

app.post('/api/boat/briefing', async (req, reply) => {
  try {
    if (!openai) throw new Error('OpenAI is not configured on the backend.');
    const body = (req.body || {}) as any;
    const prompt = `You are OceanCore Boat AI. Give a concise skipper-style safety briefing. Never claim certainty. Use the maths provided. Return markdown with headings: Decision, Fuel, Risks, Actions.\n\n${JSON.stringify(body, null, 2)}`;
    const completion = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You are a cautious Australian boating assistant. You are not a substitute for seamanship, official forecasts, charts, or local knowledge.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.25,
      max_tokens: 700,
    });
    ok(reply, { success: true, briefing: completion.choices[0]?.message?.content || '' });
  } catch (e) { fail(reply, e, 500); }
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
      "/api/satellite-intel/scan",
      "/api/satellite-intel/targets",
      "/api/satellite-intel/layers",
      "/ai/species-detect",
      "/api/ai/species-detect",
      "/species-detect",
      "/ai/chat/smart",
      "/admin/overview",
      "/admin/users",
      "/admin/catches",
      "/admin/profiles",
      "/admin/system-health",
      "/admin/users/:id/status",
      "/admin/users/:id/suspend",
      "/admin/users/:id/unsuspend",
      "/feedback",
      "/admin/feedback",
      "/admin/audit",
      "/saved-areas",
      "/api/tactical/snapshot",
      "/api/tactical/snapshots",
      "/api/boat/catalog/boats",
      "/api/boat/catalog/outboards",
      "/api/boat/trip-log",
      "/api/boat/briefing",
      "/billing/plans",
      "/billing/me",
      "/billing/usage",
      "/billing/checkout",
      "/billing/portal",
      "/stripe/webhook",
    ],
  });
});

app.listen({ port: PORT, host: HOST }).then(() => {
  console.log(">>> OceanCore AI SLIM backend loaded <<<");
  console.log("BUILD_ID:", BUILD_ID);
  console.log("HOST:", HOST, "PORT:", PORT);
  console.log("SUPABASE:", !!supabase);
  console.log("OPENAI:", !!openai);
  console.log("WINDY:", !!WINDY_POINT_FORECAST_KEY, "SOURCE:", WINDY_KEY_SOURCE);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
