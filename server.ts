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

const BUILD_ID = "OC_BACKEND_2026-04-19_V19_BETA_POLISH_FINAL";

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const WINDY_POINT_FORECAST_KEY = process.env.WINDY_POINT_FORECAST_KEY || "";

const CATCHES_TABLE = process.env.CATCHES_TABLE || "catches";
const PROFILES_TABLE = process.env.PROFILES_TABLE || "profiles";
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || "feedback_reports";
const AUDIT_TABLE = process.env.AUDIT_TABLE || "audit_log";
const USAGE_TABLE = process.env.USAGE_TABLE || "usage_daily";
const SAVED_AREAS_TABLE = process.env.SAVED_AREAS_TABLE || "saved_areas";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
const TACTICAL_SNAPSHOTS_TABLE = process.env.TACTICAL_SNAPSHOTS_TABLE || "tactical_snapshots";

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
    plan: profile.plan ?? "free",
    subscription_status: profile.subscription_status ?? "none",
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

    const result = await buildSmartReply({
      question,
      messages: Array.isArray(body.messages) ? body.messages : [],
      context: body.context || {},
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
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
