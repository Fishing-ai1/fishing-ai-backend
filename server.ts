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

import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUILD_ID = "OC_BACKEND_2026-06-22_SATELLITE_HEATMAP";

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

function envValue(name: string) {
  const value = String(process.env[name] || "").trim();
  // Treat starter placeholder strings as empty so health checks do not show false success.
  if (!value || /^your[-_ ]/i.test(value)) return "";
  return value;
}

function normalizeOriginValue(value: string) {
  return String(value || "").trim().replace(/\/$/, "");
}

function csvEnv(value: string) {
  return String(value || "")
    .split(",")
    .map(normalizeOriginValue)
    .filter(Boolean);
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

const CATCHES_TABLE = process.env.CATCHES_TABLE || "catches";
const PROFILES_TABLE = process.env.PROFILES_TABLE || "profiles";
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || "feedback_reports";
const AUDIT_TABLE = process.env.AUDIT_TABLE || "audit_log";
const USAGE_TABLE = process.env.USAGE_TABLE || "usage_daily";
const SAVED_AREAS_TABLE = process.env.SAVED_AREAS_TABLE || "saved_areas";
const COMMUNITY_POSTS_TABLE = process.env.COMMUNITY_POSTS_TABLE || "community_posts";
const COMMUNITY_MEDIA_BUCKET = process.env.COMMUNITY_MEDIA_BUCKET || "community-media";
const ACCOUNT_SETTINGS_TABLE = process.env.ACCOUNT_SETTINGS_TABLE || "account_settings";
const REWARD_LEDGER_TABLE = process.env.REWARD_LEDGER_TABLE || "reward_ledger";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
const AI_CHAT_SESSIONS_TABLE = process.env.AI_CHAT_SESSIONS_TABLE || "ai_chat_sessions";
const AI_CHAT_MESSAGES_TABLE = process.env.AI_CHAT_MESSAGES_TABLE || "ai_chat_messages";
const AI_MEMORY_TABLE = process.env.AI_MEMORY_TABLE || "ai_memory";
const AI_FEEDBACK_TABLE = process.env.AI_FEEDBACK_TABLE || "ai_feedback";

// Stripe billing / subscriptions. Put these in .env / Render, never in frontend.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_PRICE_LITE_MONTHLY = process.env.STRIPE_PRICE_LITE_MONTHLY || process.env.STRIPE_PRICE_STARTER_MONTHLY || "";
const STRIPE_PRICE_LITE_YEARLY = process.env.STRIPE_PRICE_LITE_YEARLY || process.env.STRIPE_PRICE_STARTER_YEARLY || "";
const STRIPE_PRICE_PREMIUM_MONTHLY = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_BASIC_MONTHLY || "";
const STRIPE_PRICE_PREMIUM_YEARLY = process.env.STRIPE_PRICE_PREMIUM_YEARLY || process.env.STRIPE_PRICE_PRO_YEARLY || process.env.STRIPE_PRICE_BASIC_YEARLY || "";
const STRIPE_PRICE_CREW_MONTHLY = process.env.STRIPE_PRICE_CREW_MONTHLY || "";
const STRIPE_PRICE_CREW_YEARLY = process.env.STRIPE_PRICE_CREW_YEARLY || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "";
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.resolve(process.cwd(), "../fishing-ai-frontend");
const ALLOWED_ORIGINS = csvEnv(process.env.ALLOWED_ORIGINS || FRONTEND_URL || "");
const DEFAULT_WEB_ORIGINS = csvEnv(
  process.env.DEFAULT_WEB_ORIGINS || "https://oceancore-frontend.vercel.app"
);
const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const TRUST_PROXY = String(process.env.TRUST_PROXY || (IS_PRODUCTION ? "true" : "false")).toLowerCase() !== "false";
const SECURITY_HEADERS_ENABLED = String(process.env.SECURITY_HEADERS || "true").toLowerCase() !== "false";
const RATE_LIMITS_ENABLED = String(process.env.RATE_LIMITS || "true").toLowerCase() !== "false";
const GEOCODE_SEARCH_URL = envValue("GEOCODE_SEARCH_URL") || "https://nominatim.openstreetmap.org/search";
const GEOCODE_COUNTRYCODES = envValue("GEOCODE_COUNTRYCODES");
const BODY_LIMIT_BYTES = Number(process.env.BODY_LIMIT_BYTES || 60 * 1024 * 1024);
const SATELLITE_HEATMAP_ENABLED = String(process.env.SATELLITE_HEATMAP_ENABLED || "true").toLowerCase() !== "false";
const SATELLITE_TIMEOUT_MS = Number(process.env.SATELLITE_TIMEOUT_MS || 9000);
const SATELLITE_CACHE_MS = Number(process.env.SATELLITE_CACHE_MS || 30 * 60 * 1000);
const SATELLITE_SST_URL_TEMPLATE = envValue("SATELLITE_SST_URL_TEMPLATE") ||
  "https://coastwatch.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst[(last)][({lat})][({lng})]";
const SATELLITE_CHLORO_URL_TEMPLATE = envValue("SATELLITE_CHLORO_URL_TEMPLATE") ||
  "https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPVIIRSchlanomdifDaily.json?chlor_a_diff[(last)][(0.0)][({lat})][({lng})]";
const DEFAULT_NATIVE_APP_ORIGINS = [
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:4000",
  "http://127.0.0.1:4000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].join(",");
const NATIVE_APP_ORIGINS = csvEnv(
  process.env.NATIVE_APP_ORIGINS || DEFAULT_NATIVE_APP_ORIGINS
);
const EFFECTIVE_ALLOWED_ORIGINS = Array.from(
  new Set([...DEFAULT_WEB_ORIGINS, ...ALLOWED_ORIGINS, ...NATIVE_APP_ORIGINS])
);
const ALLOW_NULL_ORIGIN = String(process.env.ALLOW_NULL_ORIGIN || "").toLowerCase() === "true";
// During beta, admin can manually assign lite/premium/crew/founder without Stripe being active.
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

const LEGAL_VERSION = "2026-06-07-rewards-beta-1";
const LEGAL_CONTACT_EMAIL = "support@oceancore.ai";

const LEGAL_DOCS = {
  version: LEGAL_VERSION,
  contact_email: LEGAL_CONTACT_EMAIL,
  terms: `OceanCore AI Beta Terms

OceanCore AI is a beta product. Features may change, fail, or be removed without notice.

You are responsible for your vessel, weather checks, trip planning, and compliance decisions. OceanCore AI is an information tool only. Do not rely on it as your only source for marine safety, legal limits, or navigation.

By using the beta, you agree not to misuse the service, interfere with the platform, or upload unlawful or harmful content.

You keep ownership of the content you upload, and you give OceanCore AI permission to process and store it as needed to operate and improve the service.

Community posts must avoid exposing another person's private information, exact fishing marks without permission, unsafe instructions, harassment, spam, or illegal activity.

OceanPoints are promotional loyalty points used to recognise eligible contributions. They have no cash value, are not property or currency, and cannot currently be transferred or redeemed. Earning rules, levels, availability, and future rewards may change. Points gained through spam, duplicate, misleading, unsafe, manipulated, or fraudulent activity may be withheld, reversed, or removed.

Future vouchers, giveaways, creator payments, sponsorships, and partner benefits are not available unless OceanCore publishes specific terms and confirms that program as active. Creator status or content performance does not guarantee payment.

You may request export or deletion of your account data from Account & Settings where supported by the app.

To the maximum extent permitted by law, OceanCore AI is not liable for indirect or consequential loss arising from beta use.

Contact: ${LEGAL_CONTACT_EMAIL}`,
  privacy: `OceanCore AI Beta Privacy Policy

We may collect account details, profile details, catch logs, saved areas, boat details, notes, photos, videos, AI prompts, AI responses, feedback, reward activity, OceanPoints balances, contribution-quality signals, device/browser diagnostics, and location information you choose to provide.

We use this data to run the product, support account sync, personalize AI answers, display marine planning context, process uploads, calculate eligible OceanPoints, detect duplicate or abusive reward activity, troubleshoot issues, provide support, improve safety and moderation, and protect the service.

We do not sell your personal information. We may use service providers such as hosting, database, storage, AI, payments, email, and diagnostics providers to operate OceanCore AI.

Exact fishing marks and GPS coordinates are treated as private user content by default. Community sharing is designed around general-area reports unless you choose otherwise.

You can export supported account data and request account deletion from Account & Settings. Some records may be retained where required for security, legal, billing, or abuse-prevention reasons.

OceanCore AI is not intended for children under 13.

Because this is a beta, product behavior and data flows may still change. We will update the legal version when material terms change.

Contact: ${LEGAL_CONTACT_EMAIL}`,
  data_rights: `OceanCore AI Account Deletion and Data Rights

You can export supported account data from Account & Settings > Account, Data & Deletion by choosing Export My Data while signed in.

You can delete your account from Account & Settings > Account, Data & Deletion by typing DELETE and choosing Delete Account.

Account deletion removes your profile, account settings, catch logs, saved areas, feedback, AI chat history, AI memory, OceanPoints ledger, community likes, community reports, and the authentication account where supported by the backend.

Community posts are marked deleted rather than kept public. Community comments may be hidden. This protects discussion integrity while removing your active identity from public surfaces.

Some records may be retained where required for security, billing, legal compliance, fraud prevention, audit logs, backups, or abuse investigation.

If you cannot access the app, contact ${LEGAL_CONTACT_EMAIL} from the email address on your OceanCore account and request account deletion or data export support.

OceanCore AI is a beta product, so deletion/export coverage may expand as new features are added.`,
  disclaimer: `OceanCore AI Marine Disclaimer

OceanCore AI is not a substitute for official forecasts, notices to mariners, navigation charts, local knowledge, or seamanship.

Fishing advice, weather signals, swell signals, and trip suggestions are estimates only.

Always verify conditions, laws, and safety requirements independently before going on the water.`,
  beta_notice: `OceanCore AI is in beta. Use caution before relying on outputs in real-world marine conditions.`,
};

function escapeHtmlText(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function legalPageHtml(title: string, text: string, active: "terms" | "privacy" | "data" | "disclaimer") {
  const nav = [
    ["Terms", "/legal/terms-of-service", "terms"],
    ["Privacy", "/legal/privacy-policy", "privacy"],
    ["Data & Deletion", "/legal/account-deletion", "data"],
    ["Marine Disclaimer", "/legal/marine-disclaimer", "disclaimer"],
  ]
    .map(([label, href, key]) => {
      const selected = key === active ? ' aria-current="page"' : "";
      return `<a${selected} href="${href}">${label}</a>`;
    })
    .join("");
  const body = escapeHtmlText(text)
    .split(/\n{2,}/)
    .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
  <title>${escapeHtmlText(title)} - OceanCore AI</title>
  <meta name="description" content="OceanCore AI ${escapeHtmlText(title)}. Version ${LEGAL_VERSION}."/>
  <meta name="theme-color" content="#040813"/>
  <style>
    :root{color-scheme:dark;--bg:#040813;--panel:#091225;--line:#20304c;--text:#edf6ff;--muted:#a9bddf;--cyan:#33efe7}
    *{box-sizing:border-box} body{margin:0;min-height:100vh;background:radial-gradient(circle at top left,rgba(51,239,231,.16),transparent 30%),linear-gradient(180deg,#02050e,var(--bg) 48%,#000);color:var(--text);font:16px/1.65 Inter,ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:28px}
    main{width:min(860px,100%);margin:0 auto;border:1px solid var(--line);border-radius:24px;background:rgba(9,18,37,.92);box-shadow:0 24px 72px rgba(0,0,0,.42);overflow:hidden}
    header{padding:28px;border-bottom:1px solid var(--line)} .brand{display:flex;gap:14px;align-items:center;margin-bottom:22px}.logo{width:48px;height:48px;border-radius:16px;background:conic-gradient(from 210deg,#49e7ff,#7dffd5,#4c6fff,#49e7ff);box-shadow:0 0 24px rgba(73,231,255,.42)}
    h1{font-size:32px;line-height:1.15;margin:0 0 8px} .muted{color:var(--muted)} nav{display:flex;gap:10px;flex-wrap:wrap} nav a{color:var(--muted);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:9px 12px;font-weight:800} nav a[aria-current=page]{color:#04121a;background:linear-gradient(135deg,#7dffd5,#49e7ff);border-color:transparent}
    section{padding:28px} p{margin:0 0 18px}.footer{border-top:1px solid var(--line);padding:18px 28px;color:var(--muted);font-size:14px} a{color:var(--cyan)}
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand"><div class="logo" aria-hidden="true"></div><div><strong>OCEANCORE AI</strong><div class="muted">Fishing, boating, and marine planning assistant.</div></div></div>
      <h1>${escapeHtmlText(title)}</h1>
      <div class="muted">Version ${LEGAL_VERSION}. Contact <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>.</div>
      <nav aria-label="Legal documents">${nav}</nav>
    </header>
    <section>${body}</section>
    <div class="footer">OceanCore AI is not a substitute for official forecasts, marine warnings, navigation charts, local knowledge, or safe seamanship.</div>
  </main>
</body>
</html>`;
}

function sendLegalPage(reply: FastifyReply, title: string, text: string, active: "terms" | "privacy" | "data" | "disclaimer") {
  return reply.type("text/html; charset=utf-8").send(legalPageHtml(title, text, active));
}

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
  general_area?: string | null;
  privacy?: string | null;
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

type CommunityPostRow = {
  id: string;
  user_id?: string | null;
  user_email?: string | null;
  author_name?: string | null;
  title?: string | null;
  species?: string | null;
  general_area?: string | null;
  caption?: string | null;
  category?: string | null;
  post_type?: string | null;
  topic?: string | null;
  bait?: string | null;
  conditions?: string | null;
  length_cm?: number | null;
  weight_kg?: number | null;
  tags?: string[] | null;
  poll_question?: string | null;
  poll_options?: { id: string; label: string; votes: number }[] | null;
  privacy?: string | null;
  media_url?: string | null;
  media_mime?: string | null;
  media_type?: string | null;
  allow_comments?: boolean | null;
  comment_permission?: string | null;
  hold_link_comments?: boolean | null;
  blocked_words?: string | null;
  upload_quality?: string | null;
  status?: string | null;
  likes_count?: number | null;
  comments_count?: number | null;
  created_at: string;
  updated_at?: string | null;
};

type CommunityCommentRow = {
  id: string;
  post_id: string;
  user_id?: string | null;
  user_email?: string | null;
  author_name?: string | null;
  body: string;
  status?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type CommunityReportRow = {
  id: string;
  post_id: string;
  user_id?: string | null;
  user_email?: string | null;
  reason?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type AccountSettingsRow = {
  user_id: string;
  user_email?: string | null;
  settings: Record<string, any>;
  created_at?: string | null;
  updated_at?: string | null;
};

type RewardLedgerRow = {
  id: string;
  user_id: string;
  user_email?: string | null;
  event_type: string;
  event_key: string;
  points: number;
  title: string;
  source_type?: string | null;
  source_id?: string | null;
  metadata?: Record<string, any>;
  status?: string | null;
  created_at: string;
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
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const COMMUNITY_POSTS_FILE = path.join(DATA_DIR, "community-posts.json");
const COMMUNITY_COMMENTS_FILE = path.join(DATA_DIR, "community-comments.json");
const COMMUNITY_REPORTS_FILE = path.join(DATA_DIR, "community-reports.json");
const COMMUNITY_LIKES_FILE = path.join(DATA_DIR, "community-likes.json");
const COMMUNITY_FOLLOWS_FILE = path.join(DATA_DIR, "community-follows.json");
const COMMUNITY_POLL_VOTES_FILE = path.join(DATA_DIR, "community-poll-votes.json");
const REWARD_LEDGER_FILE = path.join(DATA_DIR, "reward-ledger.json");
const AVATAR_IMAGE_MAX_BYTES = Number(process.env.AVATAR_IMAGE_MAX_BYTES || 5 * 1024 * 1024);
const CATCH_PHOTO_MAX_BYTES = Number(process.env.CATCH_PHOTO_MAX_BYTES || 12 * 1024 * 1024);
const COMMUNITY_MEDIA_MAX_BYTES = Number(process.env.COMMUNITY_MEDIA_MAX_BYTES || 35 * 1024 * 1024);
const COMMUNITY_VIDEO_MAX_BYTES = Number(process.env.COMMUNITY_VIDEO_MAX_BYTES || 50 * 1024 * 1024);
const IMAGE_UPLOAD_MIME_EXT = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);
const COMMUNITY_MEDIA_MIME_EXT = new Map([
  ...IMAGE_UPLOAD_MIME_EXT,
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
]);
const STRIP_IMAGE_UPLOAD_METADATA = process.env.STRIP_IMAGE_UPLOAD_METADATA !== "false";
const METADATA_STRIPPED_IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const app = Fastify({
  logger: false,
  bodyLimit: BODY_LIMIT_BYTES,
  trustProxy: TRUST_PROXY,
});

function isAllowedOrigin(origin: string | undefined) {
  const value = normalizeOriginValue(origin || "");
  if (!value) return true;
  if (value === "null") return ALLOW_NULL_ORIGIN || EFFECTIVE_ALLOWED_ORIGINS.includes("null") || !IS_PRODUCTION;
  if (EFFECTIVE_ALLOWED_ORIGINS.length) return EFFECTIVE_ALLOWED_ORIGINS.includes(value);
  if (!IS_PRODUCTION) return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(value);
  return false;
}

app.register(cors, {
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Accept", "X-Requested-With"],
  exposedHeaders: ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
});

app.addHook("onRequest", async (req, reply) => {
  if (req.method !== "OPTIONS") return;
  reply.code(204).send();
});

app.addHook("onRequest", async (req, reply) => {
  if (!SECURITY_HEADERS_ENABLED) return;
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "SAMEORIGIN");
  reply.header("X-Permitted-Cross-Domain-Policies", "none");
  reply.header("X-DNS-Prefetch-Control", "off");
  reply.header("Origin-Agent-Cluster", "?1");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(self), payment=(self)");
  if (IS_PRODUCTION) {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

const RATE_POLICIES = {
  auth: { bucket: "auth", limit: Number(process.env.RATE_LIMIT_AUTH || 20), windowMs: 15 * 60 * 1000 },
  ai: { bucket: "ai", limit: Number(process.env.RATE_LIMIT_AI || 80), windowMs: 60 * 60 * 1000 },
  media: { bucket: "media", limit: Number(process.env.RATE_LIMIT_MEDIA || 80), windowMs: 60 * 60 * 1000 },
  feedback: { bucket: "feedback", limit: Number(process.env.RATE_LIMIT_FEEDBACK || 30), windowMs: 60 * 60 * 1000 },
  write: { bucket: "write", limit: Number(process.env.RATE_LIMIT_WRITE || 300), windowMs: 60 * 60 * 1000 },
} as const;
const RATE_BUCKET_MAX = Number(process.env.RATE_BUCKET_MAX || 5000);
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function ratePolicy(req: any) {
  const method = String(req.method || "GET").toUpperCase();
  const url = String(req.url || "");
  if (!RATE_LIMITS_ENABLED) return null;
  if (method === "GET") return null;
  if (/^\/auth\/(login|signup|reset-password|magic-link|update-password)/.test(url)) return RATE_POLICIES.auth;
  if (/^\/(?:api\/)?ai\//.test(url)) return RATE_POLICIES.ai;
  if (/^\/(?:api\/)?community/.test(url) || /^\/catches\/photo/.test(url) || /^\/catches\/with-photo/.test(url)) return RATE_POLICIES.media;
  if (/^\/feedback/.test(url)) return RATE_POLICIES.feedback;
  return RATE_POLICIES.write;
}

function clientRateKey(req: any, bucket: string) {
  const forwarded = TRUST_PROXY ? String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return `${bucket}:${forwarded || req.ip || "unknown"}`;
}

app.addHook("preHandler", async (req, reply) => {
  const policy = ratePolicy(req);
  if (!policy) return;
  const now = Date.now();
  if (rateBuckets.size > RATE_BUCKET_MAX) {
    for (const [key, bucket] of rateBuckets.entries()) if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
  const key = clientRateKey(req, policy.bucket);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + policy.windowMs });
    reply.header("X-RateLimit-Limit", String(policy.limit));
    reply.header("X-RateLimit-Remaining", String(Math.max(0, policy.limit - 1)));
    reply.header("X-RateLimit-Reset", String(Math.ceil((now + policy.windowMs) / 1000)));
    return;
  }
  bucket.count += 1;
  const remaining = Math.max(0, policy.limit - bucket.count);
  reply.header("X-RateLimit-Limit", String(policy.limit));
  reply.header("X-RateLimit-Remaining", String(remaining));
  reply.header("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > policy.limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    reply.header("Retry-After", String(retryAfter));
    return reply.code(429).send({ success: false, error: "Too many requests. Slow down and try again shortly.", retry_after_seconds: retryAfter });
  }
});
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
if (fs.existsSync(path.join(FRONTEND_DIR, "index.html"))) {
  app.register(fastifyStatic, {
    root: FRONTEND_DIR,
    prefix: "/app/",
    decorateReply: false,
  });
  app.get("/app", async (_req, reply) => reply.redirect("/app/"));
}

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
  communityPosts: [] as CommunityPostRow[],
  communityComments: [] as CommunityCommentRow[],
  communityReports: [] as CommunityReportRow[],
  communityLikes: [] as { post_id: string; user_id: string; user_email?: string | null; created_at: string }[],
  communityFollows: [] as { follower_id: string; following_id: string; created_at: string }[],
  communityPollVotes: [] as { post_id: string; option_id: string; user_id: string; created_at: string }[],
  accountSettings: new Map<string, AccountSettingsRow>(),
  rewardLedger: [] as RewardLedgerRow[],
};

function ok<T>(reply: any, body: T) {
  reply.send(body);
}

function fail(reply: any, error: unknown, status = 500) {
  console.error(error);
  const code = Number((error as any)?.statusCode || status || 500);
  reply.code(Number.isFinite(code) ? clamp(code, 400, 599) : 500).send({
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

function normalizeLocationPrivacy(input: any, fallback = "private") {
  const raw = str(input, fallback).toLowerCase();
  return ["private", "general", "area_only", "public"].includes(raw) ? raw : fallback;
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
  const match = String(v || "").trim().match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  return !!(match && IMAGE_UPLOAD_MIME_EXT.has(match[1].toLowerCase()));
}

function makeAbsoluteMediaUrl(req: any, url: string | null | undefined) {
  const value = String(url || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:image/") || value.startsWith("data:video/")) return value;
  if (!value.startsWith("/media/")) return value;
  const proto =
    String(req?.headers?.["x-forwarded-proto"] || "").trim() || "http";
  const host = String(req?.headers?.host || "").trim() || `${HOST}:${PORT}`;
  return `${proto}://${host}${value}`;
}

function isDataUrlMedia(v: string) {
  const match = String(v || "").trim().match(/^data:((?:image|video)\/[a-z0-9.+-]+);base64,/i);
  return !!(match && COMMUNITY_MEDIA_MIME_EXT.has(match[1].toLowerCase()));
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

function hasCurrentLegalAcceptance(profile: ProfileRow | null | undefined) {
  return !!(
    profile?.accepted_terms_at &&
    profile?.accepted_privacy_at &&
    profile?.accepted_disclaimer_at &&
    profile?.legal_version === LEGAL_VERSION
  );
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

function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function sanitizeJsonValue(value: any, depth = 0): any {
  if (depth > 8) return null;
  const raw = unwrapBodyValue(value);
  if (raw == null) return null;
  if (typeof raw === "string") return raw.slice(0, 1000);
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.slice(0, 50).map((item) => sanitizeJsonValue(item, depth + 1));
  if (!isPlainObject(raw)) return null;
  const out: Record<string, any> = {};
  Object.entries(raw).slice(0, 200).forEach(([key, item]) => {
    const cleanKey = String(key).replace(/[^\w.-]/g, "").slice(0, 80);
    if (!cleanKey) return;
    out[cleanKey] = sanitizeJsonValue(item, depth + 1);
  });
  return out;
}

function sanitizeAccountSettings(input: any): Record<string, any> {
  const source = isPlainObject(input?.settings) ? input.settings : input;
  const settings = sanitizeJsonValue(source);
  if (!isPlainObject(settings)) throw new Error("Settings must be a JSON object.");
  const size = Buffer.byteLength(JSON.stringify(settings), "utf8");
  if (size > 64_000) throw new Error("Settings payload is too large.");
  return settings;
}

function normalizeAccountSettings(row: any, user: AuthUser): AccountSettingsRow {
  return {
    user_id: String(row?.user_id || user.id),
    user_email: row?.user_email ?? user.email ?? null,
    settings: isPlainObject(row?.settings) ? row.settings : {},
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

function settingsTableUnavailable(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "");
  return code === "42P01" || code === "PGRST205" || /account_settings|schema cache|does not exist|not found/.test(message);
}

function catchPrivacyColumnsUnavailable(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "");
  return code === "42703" || code === "PGRST204" || /general_area|privacy|schema cache|column/.test(message);
}

async function getAccountSettingsForUser(user: AuthUser): Promise<AccountSettingsRow & { storage: string; warning?: string }> {
  const fallback = () => {
    const row = mem.accountSettings.get(user.id) || {
      user_id: user.id,
      user_email: user.email ?? null,
      settings: {},
      created_at: null,
      updated_at: null,
    };
    return { ...normalizeAccountSettings(row, user), storage: "memory" };
  };

  if (!supabase || user.isGuest) return fallback();

  const res = await supabase
    .from(ACCOUNT_SETTINGS_TABLE)
    .select("user_id,user_email,settings,created_at,updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (res.error) {
    if (settingsTableUnavailable(res.error)) {
      return { ...fallback(), warning: `Run the Supabase schema migration to enable cloud settings sync (${ACCOUNT_SETTINGS_TABLE}).` };
    }
    throw res.error;
  }

  return { ...normalizeAccountSettings(res.data || {}, user), storage: "supabase" };
}

async function saveAccountSettingsForUser(user: AuthUser, settingsInput: any): Promise<AccountSettingsRow & { storage: string; warning?: string }> {
  const settings = sanitizeAccountSettings(settingsInput);
  const now = new Date().toISOString();

  if (!supabase || user.isGuest) {
    const row = normalizeAccountSettings({
      ...(mem.accountSettings.get(user.id) || {}),
      user_id: user.id,
      user_email: user.email ?? null,
      settings,
      updated_at: now,
    }, user);
    mem.accountSettings.set(user.id, row);
    return { ...row, storage: "memory" };
  }

  const res = await supabase
    .from(ACCOUNT_SETTINGS_TABLE)
    .upsert(
      {
        user_id: user.id,
        user_email: user.email ?? null,
        settings,
        updated_at: now,
      },
      { onConflict: "user_id" }
    )
    .select("user_id,user_email,settings,created_at,updated_at")
    .single();

  if (res.error) {
    if (settingsTableUnavailable(res.error)) {
      const row = normalizeAccountSettings({
        user_id: user.id,
        user_email: user.email ?? null,
        settings,
        updated_at: now,
      }, user);
      mem.accountSettings.set(user.id, row);
      return { ...row, storage: "memory", warning: `Run the Supabase schema migration to enable cloud settings sync (${ACCOUNT_SETTINGS_TABLE}).` };
    }
    throw res.error;
  }

  return { ...normalizeAccountSettings(res.data, user), storage: "supabase" };
}

const CATCH_SELECT =
  "id,user_id,user_email,species,weight_kg,length_cm,legal_limit_cm,is_legal,lat,lng,general_area,privacy,notes,photo_url,created_at";
const CATCH_SELECT_LEGACY =
  "id,user_id,user_email,species,weight_kg,length_cm,legal_limit_cm,is_legal,lat,lng,notes,photo_url,created_at";

async function listUserCatches(user: AuthUser, limit = 100): Promise<CatchRow[]> {
  if (!supabase) {
    return mem.catches
      .filter((x) => (x.user_id || DEV_GUEST_USER_ID) === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  const res = await supabase
    .from(CATCHES_TABLE)
    .select(CATCH_SELECT)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (res.error && catchPrivacyColumnsUnavailable(res.error)) {
    const legacy = await supabase
      .from(CATCHES_TABLE)
      .select(CATCH_SELECT_LEGACY)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (legacy.error) throw legacy.error;
    return (legacy.data || []).map((row: any) => ({
      ...row,
      general_area: null,
      privacy: "private",
    })) as CatchRow[];
  }

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
    general_area: str(payload.general_area, "").slice(0, 160) || null,
    privacy: normalizeLocationPrivacy(payload.privacy, "private"),
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
      general_area: row.general_area,
      privacy: row.privacy,
      notes: row.notes,
      photo_url: row.photo_url,
    })
    .select(CATCH_SELECT)
    .single();

  if (saved.error && catchPrivacyColumnsUnavailable(saved.error)) {
    const legacy = await supabase
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
      .select(CATCH_SELECT_LEGACY)
      .single();
    if (legacy.error) throw legacy.error;
    return {
      ...(legacy.data as any),
      general_area: row.general_area,
      privacy: row.privacy,
    } as CatchRow;
  }

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

const REWARD_RULES = {
  catch_submitted: { points: 10, title: "Catch logged", dailyLimit: 10 },
  catch_photo_uploaded: { points: 5, title: "Catch photo added", dailyLimit: 10 },
  species_confirmed: { points: 5, title: "Species confirmed", dailyLimit: 10 },
  community_post_created: { points: 2, title: "Community post created", dailyLimit: 5 },
  community_comment_created: { points: 1, title: "Community comment added", dailyLimit: 20 },
  trip_report_created: { points: 20, title: "Trip report shared", dailyLimit: 3 },
  weather_report_created: { points: 5, title: "Weather report shared", dailyLimit: 3 },
  water_report_created: { points: 5, title: "Water conditions shared", dailyLimit: 3 },
  ramp_report_created: { points: 5, title: "Boat ramp report shared", dailyLimit: 3 },
  hazard_report_created: { points: 10, title: "Hazard report shared", dailyLimit: 3 },
  video_uploaded: { points: 25, title: "Community video uploaded", dailyLimit: 3 },
  post_likes_25: { points: 10, title: "Post reached 25 likes", dailyLimit: 1000 },
  post_likes_100: { points: 50, title: "Post reached 100 likes", dailyLimit: 1000 },
} as const;

type RewardEventType = keyof typeof REWARD_RULES;

const REWARD_LEVELS = [
  { level: 1, name: "Deckhand", min_points: 0 },
  { level: 2, name: "Crew Member", min_points: 100 },
  { level: 3, name: "Angler", min_points: 300 },
  { level: 4, name: "Skipper", min_points: 750 },
  { level: 5, name: "Captain", min_points: 1500 },
  { level: 6, name: "Offshore Captain", min_points: 3000 },
  { level: 7, name: "Ocean Master", min_points: 7500 },
  { level: 8, name: "OceanCore Legend", min_points: 15000 },
];

const REWARD_CATALOG = [
  { id: "oceancore_plus", name: "OceanCore+ membership", category: "membership", status: "coming_soon", points: 5000 },
  { id: "fuel_voucher", name: "Fuel vouchers", category: "voucher", status: "partner_review", points: 7500 },
  { id: "tackle_voucher", name: "Tackle vouchers", category: "voucher", status: "partner_review", points: 7500 },
  { id: "camping_gear", name: "Camping gear", category: "gear", status: "coming_soon", points: 10000 },
  { id: "boat_accessories", name: "Boat accessories", category: "gear", status: "coming_soon", points: 12000 },
  { id: "merchandise", name: "OceanCore merchandise", category: "merchandise", status: "coming_soon", points: 4000 },
];

function normalizeRewardLedger(row: any): RewardLedgerRow {
  return {
    id: String(row?.id || crypto.randomUUID()),
    user_id: String(row?.user_id || DEV_GUEST_USER_ID),
    user_email: row?.user_email ?? null,
    event_type: str(row?.event_type, "unknown"),
    event_key: str(row?.event_key, crypto.randomUUID()),
    points: Math.trunc(Number(row?.points || 0)),
    title: str(row?.title, "OceanPoints earned"),
    source_type: row?.source_type ?? null,
    source_id: row?.source_id ?? null,
    metadata: row?.metadata && typeof row.metadata === "object" ? row.metadata : {},
    status: str(row?.status, "earned"),
    created_at: row?.created_at || new Date().toISOString(),
  };
}

function rewardLevelForPoints(points: number) {
  const total = Math.max(0, Math.trunc(Number(points || 0)));
  let current = REWARD_LEVELS[0];
  for (const level of REWARD_LEVELS) {
    if (total >= level.min_points) current = level;
  }
  const next = REWARD_LEVELS.find((level) => level.min_points > total) || null;
  const levelStart = current.min_points;
  const levelEnd = next?.min_points ?? total;
  const progress = next
    ? Math.max(0, Math.min(100, Math.round(((total - levelStart) / Math.max(1, levelEnd - levelStart)) * 100)))
    : 100;
  return {
    ...current,
    next,
    points_into_level: total - levelStart,
    points_to_next: next ? Math.max(0, next.min_points - total) : 0,
    progress_percent: progress,
  };
}

async function readLocalRewardLedger(): Promise<RewardLedgerRow[]> {
  try {
    const raw = await fs.promises.readFile(REWARD_LEDGER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed.map(normalizeRewardLedger) : [];
    mem.rewardLedger = rows;
    return rows;
  } catch {
    return mem.rewardLedger;
  }
}

async function writeLocalRewardLedger(rows: RewardLedgerRow[]) {
  mem.rewardLedger = rows.slice(-10000);
  await fs.promises.writeFile(REWARD_LEDGER_FILE, JSON.stringify(mem.rewardLedger, null, 2), "utf8");
}

async function listRewardLedger(user: AuthUser, limit = 5000): Promise<{ rows: RewardLedgerRow[]; storage: string }> {
  if (supabase && !user.isGuest) {
    try {
      const res = await supabase
        .from(REWARD_LEDGER_TABLE)
        .select("id,user_id,user_email,event_type,event_key,points,title,source_type,source_id,metadata,status,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(clamp(limit, 1, 5000));
      if (res.error) throw res.error;
      return { rows: (res.data || []).map(normalizeRewardLedger), storage: "supabase" };
    } catch (e) {
      console.warn("reward ledger supabase list failed, using local storage", e);
    }
  }
  const rows = await readLocalRewardLedger();
  return {
    rows: rows
      .filter((row) => row.user_id === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, clamp(limit, 1, 5000)),
    storage: "local",
  };
}

async function rewardSummaryForUser(user: AuthUser) {
  const result = await listRewardLedger(user, 5000);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const total = result.rows.reduce((sum, row) => sum + Number(row.points || 0), 0);
  const monthPoints = result.rows
    .filter((row) => row.created_at >= monthStart)
    .reduce((sum, row) => sum + Number(row.points || 0), 0);
  const byType = result.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.event_type] = (acc[row.event_type] || 0) + Number(row.points || 0);
    return acc;
  }, {});
  return {
    balance: Math.max(0, total),
    lifetime_points: Math.max(0, total),
    month_points: Math.max(0, monthPoints),
    level: rewardLevelForPoints(total),
    activity: result.rows.slice(0, 50),
    points_by_type: byType,
    storage: result.storage,
  };
}

async function awardRewardPoints(
  user: AuthUser,
  eventType: RewardEventType,
  eventKey: string,
  sourceType: string,
  sourceId: string,
  metadata: Record<string, any> = {}
) {
  const rule = REWARD_RULES[eventType];
  if (!rule) return { awarded: false, points: 0, reason: "unknown_event" };
  if (supabase && user.isGuest) return { awarded: false, points: 0, reason: "sign_in_required" };

  const now = new Date();
  const createdAt = now.toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const row = normalizeRewardLedger({
    id: crypto.randomUUID(),
    user_id: user.id,
    user_email: user.email ?? null,
    event_type: eventType,
    event_key: eventKey,
    points: rule.points,
    title: rule.title,
    source_type: sourceType,
    source_id: sourceId,
    metadata,
    status: "earned",
    created_at: createdAt,
  });

  if (supabase && !user.isGuest) {
    try {
      const existing = await supabase
        .from(REWARD_LEDGER_TABLE)
        .select("id")
        .eq("user_id", user.id)
        .eq("event_key", eventKey)
        .maybeSingle();
      if (existing.data) return { awarded: false, points: 0, reason: "already_awarded" };
      const daily = await supabase
        .from(REWARD_LEDGER_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("event_type", eventType)
        .gte("created_at", dayStart);
      if (Number(daily.count || 0) >= rule.dailyLimit) {
        return { awarded: false, points: 0, reason: "daily_limit_reached" };
      }
      const inserted = await supabase.from(REWARD_LEDGER_TABLE).insert(row);
      if (inserted.error) {
        if ((inserted.error as any)?.code === "23505") return { awarded: false, points: 0, reason: "already_awarded" };
        throw inserted.error;
      }
      return { awarded: true, points: rule.points, reason: "earned", event_type: eventType };
    } catch (e) {
      console.warn("reward ledger supabase award failed, using local storage", e);
    }
  }

  const rows = await readLocalRewardLedger();
  if (rows.some((item) => item.user_id === user.id && item.event_key === eventKey)) {
    return { awarded: false, points: 0, reason: "already_awarded" };
  }
  const dailyCount = rows.filter(
    (item) => item.user_id === user.id && item.event_type === eventType && item.created_at >= dayStart
  ).length;
  if (dailyCount >= rule.dailyLimit) return { awarded: false, points: 0, reason: "daily_limit_reached" };
  rows.push(row);
  await writeLocalRewardLedger(rows);
  return { awarded: true, points: rule.points, reason: "earned", event_type: eventType };
}

async function awardRewardBatch(
  user: AuthUser,
  events: { type: RewardEventType; key: string; sourceType: string; sourceId: string; metadata?: Record<string, any> }[]
) {
  const awards = [];
  for (const event of events) {
    awards.push(await awardRewardPoints(user, event.type, event.key, event.sourceType, event.sourceId, event.metadata));
  }
  return awards;
}

function rewardEventsForCatch(row: CatchRow, speciesConfirmed = false) {
  const events: { type: RewardEventType; key: string; sourceType: string; sourceId: string; metadata?: Record<string, any> }[] = [
    { type: "catch_submitted", key: `catch:${row.id}:submitted`, sourceType: "catch", sourceId: row.id },
  ];
  if (row.photo_url) events.push({ type: "catch_photo_uploaded", key: `catch:${row.id}:photo`, sourceType: "catch", sourceId: row.id });
  if (speciesConfirmed) events.push({
    type: "species_confirmed",
    key: `catch:${row.id}:species-confirmed`,
    sourceType: "catch",
    sourceId: row.id,
    metadata: { species: row.species },
  });
  return events;
}

function communityReportRewardType(post: CommunityPostRow): RewardEventType | null {
  const text = `${post.title || ""} ${post.caption || ""} ${post.species || ""}`.toLowerCase();
  if (/(hazard|danger|debris|bar crossing|unsafe|warning)/.test(text)) return "hazard_report_created";
  if (/(trip report|trip recap|trip summary)/.test(text)) return "trip_report_created";
  if (/(ramp|boat ramp|launch|pontoon|jetty)/.test(text)) return "ramp_report_created";
  if (/(weather|wind|swell|storm|rain|forecast)/.test(text)) return "weather_report_created";
  if (/(water condition|water temp|temperature|clarity|current|tide)/.test(text)) return "water_report_created";
  return null;
}

function rewardEventsForCommunityPost(post: CommunityPostRow) {
  const events: { type: RewardEventType; key: string; sourceType: string; sourceId: string; metadata?: Record<string, any> }[] = [
    { type: "community_post_created", key: `community-post:${post.id}:created`, sourceType: "community_post", sourceId: post.id },
  ];
  if (post.media_type === "video" || String(post.media_mime || "").startsWith("video/")) {
    events.push({ type: "video_uploaded", key: `community-post:${post.id}:video`, sourceType: "community_post", sourceId: post.id });
  }
  const reportType = communityReportRewardType(post);
  if (reportType) {
    events.push({ type: reportType, key: `community-post:${post.id}:${reportType}`, sourceType: "community_post", sourceId: post.id });
  }
  return events;
}

async function awardCommunityLikeMilestones(post: CommunityPostRow, likesCount: number) {
  if (!post.user_id) return [];
  const owner: AuthUser = { id: post.user_id, email: post.user_email ?? null, isGuest: false, user_metadata: {} };
  const events = [];
  if (likesCount >= 25) events.push({ type: "post_likes_25" as RewardEventType, key: `community-post:${post.id}:likes-25`, sourceType: "community_post", sourceId: post.id });
  if (likesCount >= 100) events.push({ type: "post_likes_100" as RewardEventType, key: `community-post:${post.id}:likes-100`, sourceType: "community_post", sourceId: post.id });
  return awardRewardBatch(owner, events);
}

async function reconcileUserRewards(user: AuthUser) {
  const awards = [];
  const catches = await listUserCatches(user, 1000).catch(() => []);
  for (const row of catches) awards.push(...(await awardRewardBatch(user, rewardEventsForCatch(row, false))));
  const community = await listCommunityPostsForUser(user, "").catch(() => ({ posts: [] as CommunityPostRow[], storage: "unavailable" }));
  for (const post of community.posts.filter((row) => row.user_id === user.id && row.status !== "deleted")) {
    awards.push(...(await awardRewardBatch(user, rewardEventsForCommunityPost(post))));
    awards.push(...(await awardCommunityLikeMilestones(post, Number(post.likes_count || 0))));
  }
  return {
    checked: catches.length + community.posts.filter((row) => row.user_id === user.id).length,
    awarded_points: awards.filter((award: any) => award.awarded).reduce((sum: number, award: any) => sum + Number(award.points || 0), 0),
    awards,
  };
}

function uploadError(message: string, statusCode = 400) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function mb(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}

function estimateBase64Bytes(base64: string) {
  const clean = base64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function validateUploadSignature(mime: string, buffer: Buffer) {
  if (buffer.length < 8) return false;
  const ascii4 = (start: number, end: number) => buffer.subarray(start, end).toString("ascii");
  if ((mime === "image/jpeg" || mime === "image/jpg") && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (mime === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (mime === "image/webp" && ascii4(0, 4) === "RIFF" && ascii4(8, 12) === "WEBP") return true;
  const hasFtyp = buffer.length >= 12 && ascii4(4, 8) === "ftyp";
  if ((mime === "image/heic" || mime === "image/heif") && hasFtyp) {
    return /heic|heix|hevc|hevx|mif1|msf1/i.test(ascii4(8, Math.min(buffer.length, 40)));
  }
  if ((mime === "video/mp4" || mime === "video/quicktime") && hasFtyp) return true;
  if (mime === "video/webm" && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
  return false;
}

function stripJpegMetadata(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;

  const parts: Buffer[] = [buffer.subarray(0, 2)];
  let pos = 2;
  const shouldDropMarker = (marker: number) => marker === 0xe1 || marker === 0xed || marker === 0xfe;

  while (pos < buffer.length) {
    if (buffer[pos] !== 0xff) {
      parts.push(buffer.subarray(pos));
      break;
    }

    const markerStart = pos;
    while (pos < buffer.length && buffer[pos] === 0xff) pos += 1;
    if (pos >= buffer.length) {
      parts.push(buffer.subarray(markerStart));
      break;
    }

    const marker = buffer[pos];
    pos += 1;

    if (marker === 0xda || marker === 0xd9) {
      parts.push(buffer.subarray(markerStart));
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buffer.subarray(markerStart, pos));
      continue;
    }

    if (pos + 2 > buffer.length) return buffer;
    const segmentLength = buffer.readUInt16BE(pos);
    if (segmentLength < 2) return buffer;
    const segmentEnd = pos + segmentLength;
    if (segmentEnd > buffer.length) return buffer;

    if (!shouldDropMarker(marker)) {
      parts.push(buffer.subarray(markerStart, segmentEnd));
    }
    pos = segmentEnd;
  }

  const stripped = Buffer.concat(parts);
  return stripped.length > 2 ? stripped : buffer;
}

function stripPngMetadata(buffer: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 20 || !buffer.subarray(0, 8).equals(signature)) return buffer;

  const metadataChunks = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
  const parts: Buffer[] = [buffer.subarray(0, 8)];
  let pos = 8;
  let sawEnd = false;

  while (pos + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.subarray(pos + 4, pos + 8).toString("ascii");
    const chunkEnd = pos + 12 + length;
    if (chunkEnd > buffer.length) return buffer;

    if (!metadataChunks.has(type)) {
      parts.push(buffer.subarray(pos, chunkEnd));
    }

    pos = chunkEnd;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }

  return sawEnd ? Buffer.concat(parts) : buffer;
}

function stripWebpMetadata(buffer: Buffer) {
  if (
    buffer.length < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return buffer;
  }

  const metadataChunks = new Set(["EXIF", "XMP "]);
  const parts: Buffer[] = [];
  let pos = 12;

  while (pos + 8 <= buffer.length) {
    const type = buffer.subarray(pos, pos + 4).toString("ascii");
    const length = buffer.readUInt32LE(pos + 4);
    const dataEnd = pos + 8 + length;
    const paddedEnd = dataEnd + (length % 2);
    if (paddedEnd > buffer.length) return buffer;

    if (!metadataChunks.has(type)) {
      parts.push(buffer.subarray(pos, paddedEnd));
    }

    pos = paddedEnd;
  }

  if (pos !== buffer.length) return buffer;
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}

function stripImageUploadMetadata(mime: string, buffer: Buffer) {
  if (!STRIP_IMAGE_UPLOAD_METADATA) return buffer;

  try {
    if (mime === "image/jpeg" || mime === "image/jpg") return stripJpegMetadata(buffer);
    if (mime === "image/png") return stripPngMetadata(buffer);
    if (mime === "image/webp") return stripWebpMetadata(buffer);
  } catch (e) {
    console.warn("image metadata stripping failed; storing original upload", e);
  }

  return buffer;
}

function parseDataUrlUpload(
  dataUrl: string,
  allowed: Map<string, string>,
  maxBytes: number,
  label: string
) {
  const match = String(dataUrl || "").trim().match(/^data:((?:image|video)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) throw uploadError(`Invalid ${label} data URL.`);

  const mime = match[1].toLowerCase();
  const ext = allowed.get(mime);
  if (!ext) {
    throw uploadError(`${label} must be one of: ${[...allowed.keys()].join(", ")}.`);
  }

  const base64 = match[2].replace(/\s/g, "");
  if (!/^[a-z0-9+/]+={0,2}$/i.test(base64)) throw uploadError(`Invalid ${label} base64 data.`);
  if (estimateBase64Bytes(base64) > maxBytes) {
    throw uploadError(`${label} is too large. Try under ${mb(maxBytes)}MB.`, 413);
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw uploadError(`${label} is empty.`);
  if (buffer.length > maxBytes) throw uploadError(`${label} is too large. Try under ${mb(maxBytes)}MB.`, 413);
  if (!validateUploadSignature(mime, buffer)) {
    throw uploadError(`${label} does not match its declared file type.`);
  }

  return { mime, ext, buffer };
}

async function saveDataUrlImage(
  dataUrl: string,
  options: { maxBytes?: number; prefix?: string; label?: string } = {}
): Promise<string> {
  const parsed = parseDataUrlUpload(
    dataUrl,
    IMAGE_UPLOAD_MIME_EXT,
    options.maxBytes || CATCH_PHOTO_MAX_BYTES,
    options.label || "Image"
  );
  const storageBuffer = stripImageUploadMetadata(parsed.mime, parsed.buffer);
  const filename = `${options.prefix || ""}${Date.now()}-${crypto.randomUUID()}.${parsed.ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filepath, storageBuffer);
  return `/media/${filename}`;
}

async function saveDataUrlMedia(dataUrl: string): Promise<{ url: string; mime: string; type: string }> {
  const parsed = parseDataUrlUpload(
    dataUrl,
    COMMUNITY_MEDIA_MIME_EXT,
    COMMUNITY_MEDIA_MAX_BYTES,
    "Community media"
  );
  const storageBuffer = stripImageUploadMetadata(parsed.mime, parsed.buffer);
  const filename = `community-${Date.now()}-${crypto.randomUUID()}.${parsed.ext}`;

  if (supabase) {
    try {
      const uploaded = await supabase.storage
        .from(COMMUNITY_MEDIA_BUCKET)
        .upload(filename, storageBuffer, {
          contentType: parsed.mime,
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploaded.error) throw uploaded.error;
      const publicUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(filename).data.publicUrl;
      if (!publicUrl) throw new Error("Supabase did not return a public media URL.");
      return {
        url: publicUrl,
        mime: parsed.mime,
        type: parsed.mime.startsWith("video/") ? "video" : "image",
      };
    } catch (e) {
      console.warn("community media Supabase upload failed", e);
      if (IS_PRODUCTION) {
        throw uploadError("Video could not be saved safely. Please try again shortly.", 503);
      }
    }
  }

  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filepath, storageBuffer);
  return {
    url: `/media/${filename}`,
    mime: parsed.mime,
    type: parsed.mime.startsWith("video/") ? "video" : "image",
  };
}

function safeStorageObjectName(value: string) {
  return String(value || "video")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-120) || "video";
}

const communityMediaUploadTicketHandler = async (req: any, reply: any) => {
  try {
    const user = await getRequiredAuthUser(req);
    if (!supabase) throw uploadError("Permanent video storage is not configured.", 503);
    const body = (req.body || {}) as any;
    const mime = str(body.mime, "").toLowerCase();
    const size = Number(body.size || 0);
    const originalName = safeStorageObjectName(str(body.name, "video.mp4"));
    if (!mime.startsWith("video/") || !COMMUNITY_MEDIA_MIME_EXT.has(mime)) {
      throw uploadError("Choose an MP4, MOV, or WebM video.", 400);
    }
    const buckets = await supabase.storage.listBuckets();
    if (buckets.error) throw buckets.error;
    const bucketLimit = Number((buckets.data || []).find((bucket: any) => bucket.name === COMMUNITY_MEDIA_BUCKET)?.file_size_limit || COMMUNITY_VIDEO_MAX_BYTES);
    const effectiveLimit = Math.min(COMMUNITY_VIDEO_MAX_BYTES, bucketLimit);
    if (!Number.isFinite(size) || size <= 0 || size > effectiveLimit) {
      throw uploadError(`This video is larger than the current ${Math.floor(effectiveLimit / 1024 / 1024)}MB storage limit. Upgrade the Supabase Storage limit to enable hour-long uploads.`, 400);
    }
    const objectPath = `${user.id}/${Date.now()}-${crypto.randomUUID()}-${originalName}`;
    const signed = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).createSignedUploadUrl(objectPath, { upsert: false });
    if (signed.error || !signed.data?.token) throw signed.error || new Error("Could not create video upload ticket.");
    const publicUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    const projectId = new URL(SUPABASE_URL).hostname.split(".")[0];
    ok(reply, {
      success: true,
      bucket: COMMUNITY_MEDIA_BUCKET,
      object_path: objectPath,
      public_url: publicUrl,
      upload_token: signed.data.token,
      resumable_endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      chunk_size: 6 * 1024 * 1024,
      max_bytes: effectiveLimit,
    });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
};
app.post("/community/media/upload-ticket", communityMediaUploadTicketHandler);
app.post("/api/community/media/upload-ticket", communityMediaUploadTicketHandler);

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

async function searchGeocode(query: string, limit = 5) {
  const q = str(query).replace(/\s+/g, " ").slice(0, 160);
  if (q.length < 2) throw new Error("Search text is too short.");

  const url = new URL(GEOCODE_SEARCH_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  const safeLimit = Number.isFinite(Number(limit)) ? clamp(Math.round(Number(limit)), 1, 8) : 5;
  url.searchParams.set("limit", String(safeLimit));
  if (GEOCODE_COUNTRYCODES) url.searchParams.set("countrycodes", GEOCODE_COUNTRYCODES);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "OceanCoreAI/1.0 support@oceancore.ai",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Location search failed (${res.status})`);

    const rows = (await res.json()) as any[];
    return (Array.isArray(rows) ? rows : [])
      .map((row, index) => {
        const lat = Number(row.lat);
        const lng = Number(row.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const address = row.address || {};
        const name =
          str(row.name) ||
          str(address.suburb) ||
          str(address.city) ||
          str(address.town) ||
          str(address.village) ||
          str(row.display_name, "Location");
        return {
          id: str(row.place_id, `geocode-${index}`),
          name,
          label: str(row.display_name, name),
          lat,
          lng,
          type: str(row.type || row.class, "place"),
          importance: Number.isFinite(Number(row.importance)) ? Number(row.importance) : null,
          source: "geocode",
        };
      })
      .filter(Boolean);
  } catch (error) {
    if ((error as any)?.name === "AbortError") throw new Error("Location search timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
- Use the user's profile, saved areas, catch history, marine conditions, ramps/fuel, and chat history.
- Give direct practical advice that helps the user decide what to do next.
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
        `Once OPENAI_API_KEY is set, OceanCore AI Brain V12 will use profile, catches, saved areas, marine conditions, ramps, and fuel context.`,
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
app.get("/", async (req, reply) => {
  const wantsHtml = String(req.headers.accept || "").includes("text/html");
  if (wantsHtml && fs.existsSync(path.join(FRONTEND_DIR, "index.html"))) {
    return reply.redirect("/app/");
  }
  ok(reply, {
    success: true,
    name: "OceanCore AI Slim Beta Backend",
    build_id: BUILD_ID,
    app: fs.existsSync(path.join(FRONTEND_DIR, "index.html")) ? "/app/" : null,
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
    satellite_heatmap_configured: SATELLITE_HEATMAP_ENABLED,
    satellite_sst_template_configured: !!SATELLITE_SST_URL_TEMPLATE,
    satellite_chlorophyll_template_configured: !!SATELLITE_CHLORO_URL_TEMPLATE,
    geocode_search_configured: !!GEOCODE_SEARCH_URL,
    geocode_countrycodes: GEOCODE_COUNTRYCODES || null,
    weather_api_key_alias_present: !!envValue("WEATHER_API_KEY"),
    stripe_configured: !!STRIPE_SECRET_KEY,
    stripe_prices_configured: stripePricesConfigured(),
    frontend_app_available: fs.existsSync(path.join(FRONTEND_DIR, "index.html")),
    frontend_app_path: "/app/",
    catches_table: CATCHES_TABLE,
    profiles_table: PROFILES_TABLE,
    feedback_table: FEEDBACK_TABLE,
    community_posts_table: COMMUNITY_POSTS_TABLE,
    community_media_bucket: COMMUNITY_MEDIA_BUCKET,
    durable_community_required: IS_PRODUCTION,
    account_settings_table: ACCOUNT_SETTINGS_TABLE,
    reward_ledger_table: REWARD_LEDGER_TABLE,
    audit_table: AUDIT_TABLE,
    using_profiles_table: !!PROFILES_TABLE,
    admin_enabled: ADMIN_EMAILS.length > 0 || ADMIN_USER_IDS.length > 0,
    security_headers_enabled: SECURITY_HEADERS_ENABLED,
    rate_limits_enabled: RATE_LIMITS_ENABLED,
    trust_proxy: TRUST_PROXY,
    body_limit_bytes: BODY_LIMIT_BYTES,
    allowed_origin_count: EFFECTIVE_ALLOWED_ORIGINS.length,
    native_app_origins: NATIVE_APP_ORIGINS,
    file_origin_allowed: ALLOW_NULL_ORIGIN || EFFECTIVE_ALLOWED_ORIGINS.includes("null") || !IS_PRODUCTION,
    upload_limits: {
      avatar_image_max_bytes: AVATAR_IMAGE_MAX_BYTES,
      catch_photo_max_bytes: CATCH_PHOTO_MAX_BYTES,
      community_media_max_bytes: COMMUNITY_MEDIA_MAX_BYTES,
      community_video_max_bytes: COMMUNITY_VIDEO_MAX_BYTES,
      image_mime_types: [...IMAGE_UPLOAD_MIME_EXT.keys()],
      community_media_mime_types: [...COMMUNITY_MEDIA_MIME_EXT.keys()],
      strip_image_metadata: STRIP_IMAGE_UPLOAD_METADATA,
      metadata_stripped_image_mime_types: METADATA_STRIPPED_IMAGE_MIME_TYPES,
    },
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
      "community",
      "community_moderation",
      "account_settings",
      "data_export",
      "boat_ai",
      "boat_catalog",
      "fuel_logs",
      "subscription_status",
      "stripe_checkout",
      "free_lite_premium_crew_plans",
      "oceancore_rewards",
      "oceanpoints_ledger",
      "reward_levels",
    ],
    removed_features: [
      "predict",
      "patterns",
      "undersize",
      "saved_ramps",
      "memory_pages",
      "web_learn",
    ],
  });
});

app.get("/legal/docs", async (_req, reply) => {
  ok(reply, { success: true, ...LEGAL_DOCS });
});

app.get("/legal", async (_req, reply) => {
  return sendLegalPage(reply, "Privacy Policy", LEGAL_DOCS.privacy, "privacy");
});

app.get("/legal/terms-of-service", async (_req, reply) => {
  return sendLegalPage(reply, "Terms of Service", LEGAL_DOCS.terms, "terms");
});

app.get("/legal/privacy-policy", async (_req, reply) => {
  return sendLegalPage(reply, "Privacy Policy", LEGAL_DOCS.privacy, "privacy");
});

app.get("/legal/account-deletion", async (_req, reply) => {
  return sendLegalPage(reply, "Account Deletion and Data Rights", LEGAL_DOCS.data_rights, "data");
});

app.get("/legal/marine-disclaimer", async (_req, reply) => {
  return sendLegalPage(reply, "Marine Disclaimer", LEGAL_DOCS.disclaimer, "disclaimer");
});

app.get("/legal/terms", async (_req, reply) => {
  ok(reply, { success: true, version: LEGAL_VERSION, text: LEGAL_DOCS.terms });
});

app.get("/legal/privacy", async (_req, reply) => {
  ok(reply, { success: true, version: LEGAL_VERSION, text: LEGAL_DOCS.privacy });
});

app.get("/legal/data-rights", async (_req, reply) => {
  ok(reply, { success: true, version: LEGAL_VERSION, text: LEGAL_DOCS.data_rights });
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

app.post("/auth/avatar", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const body = (req.body || {}) as any;
    const dataUrl = str(body.avatar_data_url || body.avatarDataUrl || body.data_url);
    if (!isDataUrlImage(dataUrl)) throw new Error("Upload an image file for your avatar.");
    const avatarUrl = await saveDataUrlImage(dataUrl, {
      maxBytes: AVATAR_IMAGE_MAX_BYTES,
      prefix: "avatar-",
      label: "Avatar image",
    });
    const current = await getProfileForUser(user).catch(() => null);
    const profile = await saveProfileForUser(user, {
      ...(current || {}),
      id: user.id,
      email: user.email,
      avatar_url: avatarUrl,
    });
    ok(reply, { success: true, avatar_url: makeAbsoluteMediaUrl(req, avatarUrl), profile });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.patch("/auth/email", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const email = str((req.body as any)?.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (!supabase) throw new Error("Email changes need Supabase auth configured.");
    await supabase.auth.admin.updateUserById(user.id, { email } as any);
    const current = await getProfileForUser(user).catch(() => null);
    const profile = await saveProfileForUser({ ...user, email }, { ...(current || {}), id: user.id, email });
    ok(reply, { success: true, message: "Email update started. You may need to confirm it by email.", profile });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.post("/auth/logout", async (_req, reply) => {
  ok(reply, { success: true, message: "Signed out." });
});

app.get("/auth/me", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const profile = await getProfileForUser(user);
    const accountSettings = await getAccountSettingsForUser(user).catch((error) => {
      console.warn("account settings load failed", error);
      return null;
    });
    ok(reply, {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        is_guest: user.isGuest,
      },
      profile,
      settings: accountSettings?.settings || {},
      settings_storage: accountSettings?.storage || "unavailable",
      settings_warning: accountSettings?.warning || null,
      settings_updated_at: accountSettings?.updated_at || null,
      legal: {
        version: LEGAL_VERSION,
        accepted_version: profile.legal_version || null,
        terms: hasCurrentLegalAcceptance(profile),
        privacy: hasCurrentLegalAcceptance(profile),
        disclaimer: hasCurrentLegalAcceptance(profile),
        accepted: hasCurrentLegalAcceptance(profile),
      },
    });
  } catch (e) {
    fail(reply, e, 401);
  }
});

app.get("/auth/settings", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const row = await getAccountSettingsForUser(user);
    ok(reply, {
      success: true,
      settings: row.settings,
      storage: row.storage,
      warning: row.warning || null,
      updated_at: row.updated_at || null,
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 401);
  }
});

app.patch("/auth/settings", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const row = await saveAccountSettingsForUser(user, req.body || {});
    ok(reply, {
      success: true,
      settings: row.settings,
      storage: row.storage,
      warning: row.warning || null,
      updated_at: row.updated_at || null,
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 401);
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

app.get("/auth/export-data", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const profile = await getProfileForUser(user);
    const accountSettings = await getAccountSettingsForUser(user).catch(() => null);
    const catches = await listUserCatches(user, 1000).catch(() => []);
    const savedAreas = await listSavedAreasForUser(user, 1000).catch(() => []);
    const community = await listCommunityPostsForUser(user, "").catch(() => ({ posts: [] as CommunityPostRow[], storage: "unavailable" }));
    const feedback = supabase
      ? await supabase.from(FEEDBACK_TABLE).select("id,type,message,page,status,created_at,updated_at").eq("user_id", user.id).limit(1000).then((r) => r.data || []).catch(() => [])
      : mem.feedback.filter((row) => row.user_id === user.id || row.user_email === user.email);
    const aiChats = await listAiChatSessionsForUser(user, 500).catch(() => []);
    const rewards = await listRewardLedger(user, 5000).catch(() => ({ rows: [] as RewardLedgerRow[], storage: "unavailable" }));
    ok(reply, {
      success: true,
      exported_at: new Date().toISOString(),
      user: { id: user.id, email: user.email },
      profile,
      settings: accountSettings?.settings || {},
      catches,
      saved_areas: savedAreas,
      community_posts: community.posts,
      feedback,
      ai_chat_sessions: aiChats,
      reward_ledger: rewards.rows,
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.delete("/auth/account", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const confirm = str((req.body as any)?.confirm, "");
    if (confirm !== "DELETE") throw new Error('Type DELETE to confirm account deletion.');

    if (!supabase) {
      mem.profiles.delete(user.id);
      mem.accountSettings.delete(user.id);
      mem.catches = mem.catches.filter((row) => row.user_id !== user.id);
      mem.savedAreas = mem.savedAreas.filter((row) => row.user_id !== user.id);
      mem.feedback = mem.feedback.filter((row) => row.user_id !== user.id);
      mem.rewardLedger = mem.rewardLedger.filter((row) => row.user_id !== user.id);
      await writeLocalRewardLedger(mem.rewardLedger);
      mem.communityPosts = mem.communityPosts.map((row) => row.user_id === user.id ? normalizeCommunityPost({ ...row, status: "deleted" }) : row);
      await writeLocalCommunityPosts(mem.communityPosts);
      ok(reply, { success: true, deleted: true, storage: "local" });
      return;
    }

    await Promise.allSettled([
      supabase.from(CATCHES_TABLE).delete().eq("user_id", user.id),
      supabase.from(SAVED_AREAS_TABLE).delete().eq("user_id", user.id),
      supabase.from(FEEDBACK_TABLE).delete().eq("user_id", user.id),
      supabase.from("community_likes").delete().eq("user_id", user.id),
      supabase.from("community_comments").update({ status: "hidden", updated_at: new Date().toISOString() }).eq("user_id", user.id),
      supabase.from("community_reports").delete().eq("user_id", user.id),
      supabase.from(COMMUNITY_POSTS_TABLE).update({ status: "deleted", updated_at: new Date().toISOString() }).eq("user_id", user.id),
      supabase.from(AI_CHAT_MESSAGES_TABLE).delete().eq("user_id", user.id),
      supabase.from(AI_CHAT_SESSIONS_TABLE).delete().eq("user_id", user.id),
      supabase.from(AI_MEMORY_TABLE).delete().eq("user_id", user.id),
      supabase.from(REWARD_LEDGER_TABLE).delete().eq("user_id", user.id),
      supabase.from(ACCOUNT_SETTINGS_TABLE).delete().eq("user_id", user.id),
      supabase.from(PROFILES_TABLE).delete().eq("id", user.id),
    ]);
    await supabase.auth.admin.deleteUser(user.id).catch((e) => console.warn("auth delete failed", e));
    ok(reply, { success: true, deleted: true, storage: "supabase" });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
});

app.get("/auth/legal-status", async (req, reply) => {
  try {
    const user = await getRequiredAuthUser(req);
    const profile = await getProfileForUser(user);
    ok(reply, {
      success: true,
      version: LEGAL_VERSION,
      accepted_version: profile.legal_version || null,
      accepted: hasCurrentLegalAcceptance(profile),
      terms: hasCurrentLegalAcceptance(profile),
      privacy: hasCurrentLegalAcceptance(profile),
      disclaimer: hasCurrentLegalAcceptance(profile),
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
      legal_version: LEGAL_VERSION,
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
      accepted: hasCurrentLegalAcceptance(saved),
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
      throw uploadError("photo_data_url must be a JPG, PNG, WebP, HEIC, or HEIF image.");
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
    } else if (!photoUrl && photoDataUrl) {
      throw uploadError("Catch photo must be a JPG, PNG, WebP, HEIC, or HEIF image.");
    }

    const saved = await insertCatch(user, {
      species: cleanSpecies(body.species),
      weight_kg: num(body.weight_kg),
      length_cm: num(body.length_cm),
      legal_limit_cm: num(body.legal_limit_cm),
      lat: num(body.lat),
      lng: num(body.lng),
      general_area: str(body.general_area) || null,
      privacy: normalizeLocationPrivacy(body.privacy, "private"),
      notes: str(body.notes) || null,
      photo_url: photoUrl,
    });
    const rewards = await awardRewardBatch(user, rewardEventsForCatch(saved, body.species_confirmed === true));

    ok(reply, {
      success: true,
      catch: {
        ...saved,
        photo_url: makeAbsoluteMediaUrl(req, saved.photo_url),
      },
      rewards,
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
    } else if (!photoUrl && photoDataUrl) {
      throw uploadError("Catch photo must be a JPG, PNG, WebP, HEIC, or HEIF image.");
    }

    const saved = await insertCatch(user, {
      species: cleanSpecies(body.species),
      weight_kg: num(body.weight_kg),
      length_cm: num(body.length_cm),
      legal_limit_cm: num(body.legal_limit_cm),
      lat: num(body.lat),
      lng: num(body.lng),
      general_area: str(body.general_area) || null,
      privacy: normalizeLocationPrivacy(body.privacy, "private"),
      notes: str(body.notes) || null,
      photo_url: photoUrl,
    });
    const rewards = await awardRewardBatch(user, rewardEventsForCatch(saved, body.species_confirmed === true));

    ok(reply, {
      success: true,
      catch: {
        ...saved,
        photo_url: makeAbsoluteMediaUrl(req, saved.photo_url),
      },
      rewards,
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

const rewardsCatalogHandler = async (_req: any, reply: any) => {
  ok(reply, {
    success: true,
    program: "OceanCore Rewards",
    currency: "OceanPoints",
    phase: "earn_and_track",
    rules: Object.entries(REWARD_RULES).map(([event_type, rule]) => ({ event_type, ...rule })),
    levels: REWARD_LEVELS,
    catalog: REWARD_CATALOG,
    notice: "OceanPoints have no cash value. Redemption partners, giveaways, and creator payouts are not active until their terms and operations are approved.",
  });
};

const rewardsMeHandler = async (req: any, reply: any) => {
  try {
    const user = supabase ? await getRequiredAuthUser(req) : await getAuthUser(req);
    const summary = await rewardSummaryForUser(user);
    ok(reply, {
      success: true,
      user: { id: user.id, email: user.email },
      ...summary,
      creator: {
        enrolled: false,
        level: null,
        founder_creator_places: 100,
        status: "applications_coming_soon",
      },
      catalog: REWARD_CATALOG,
      rules: Object.entries(REWARD_RULES).map(([event_type, rule]) => ({ event_type, ...rule })),
      levels: REWARD_LEVELS,
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
};

const rewardsReconcileHandler = async (req: any, reply: any) => {
  try {
    const user = supabase ? await getRequiredAuthUser(req) : await getAuthUser(req);
    const result = await reconcileUserRewards(user);
    const summary = await rewardSummaryForUser(user);
    ok(reply, { success: true, ...result, summary });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
};

app.get("/rewards/catalog", rewardsCatalogHandler);
app.get("/api/rewards/catalog", rewardsCatalogHandler);
app.get("/rewards/me", rewardsMeHandler);
app.get("/api/rewards/me", rewardsMeHandler);
app.post("/rewards/reconcile", rewardsReconcileHandler);
app.post("/api/rewards/reconcile", rewardsReconcileHandler);

app.get("/api/geocode/search", async (req, reply) => {
  try {
    const query = str((req.query as any)?.q || (req.query as any)?.query);
    const rawLimit = Number((req.query as any)?.limit || 5);
    const limit = Number.isFinite(rawLimit) ? clamp(rawLimit, 1, 8) : 5;
    const results = await searchGeocode(query, limit);
    ok(reply, { success: true, query, results });
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

const satelliteHeatmapHandler = async (req: any, reply: any) => {
  try {
    const lat = num(req.query?.lat);
    const lng = num(req.query?.lng);
    const radiusKm = clamp(Number(req.query?.radius_km || 35), 5, 120);
    const species = str(req.query?.species || "pelagics", "pelagics");
    if (lat == null || lng == null) {
      reply.code(400).send({ success: false, error: "lat and lng are required" });
      return;
    }
    ok(reply, await buildSatelliteHeatmap({ lat, lng, radiusKm, species }));
  } catch (e) {
    fail(reply, e);
  }
};

app.get("/satellite/heatmap", satelliteHeatmapHandler);
app.get("/api/satellite/heatmap", satelliteHeatmapHandler);

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
    const saveHistory = body.save_history !== false && body.context?.ai_settings?.save_chat_history !== false;
    const session = saveHistory
      ? await ensureAiChatSessionForUser(user, str(body.session_id, ""), chatTitleFromQuestion(question))
      : null;
    const priorMessages = session
      ? await listAiChatMessagesForUser(user, session.id, 24).catch(() => [])
      : [];

    const userMessage = session
      ? await saveAiChatMessageForUser(user, {
          session_id: session.id,
          role: "user",
          content: question,
          mode: detectMode(question),
        })
      : null;

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

    const assistantMessage = session
      ? await saveAiChatMessageForUser(user, {
          session_id: session.id,
          role: "assistant",
          content: result.answer || "No answer returned.",
          mode: result.mode,
        })
      : null;

    if (session && (session.title === "New chat" || !session.title)) {
      await touchAiChatSession(session.id, user, { title: chatTitleFromQuestion(question) });
    }

    const usedAfter = await incrementAiUsageCount(user, usageBefore.date);
    ok(reply, {
      ...result,
      session_id: session?.id || null,
      user_message: userMessage,
      assistant_message: assistantMessage,
      saved_history: saveHistory,
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
// Billing / subscriptions — Free, Lite, Premium, Crew
// ============================================================
type PlanKey = "free" | "lite" | "premium" | "crew" | "founder";
type BillingInterval = "monthly" | "yearly";

const PLAN_CATALOG: Record<PlanKey, any> = {
  free: { key: "free", product_id: "oceancore_free", name: "Free", tagline: "Start logging and join the community", monthly_price_aud: 0, yearly_price_aud: 0, price_label: "A$0", ads_enabled: true, ai_daily_limit: 5, saved_area_limit: 3, catch_card_level: "basic", catch_log: "limited/basic", ai: "limited", live_zones: false, delayed_zones: false, game_access: "demo", rewards: "basic", crew: false, features: ["Community feed access", "Upload catches", "Basic catch log", "Basic weather/tide preview", "Limited AI questions", "Demo OceanCore Offshore access", "Ads enabled", "Basic rewards points"], excluded_features: ["Live fishing zones", "Advanced AI pattern memory", "Premium game events", "Crew sharing", "Premium rewards"] },
  lite: { key: "lite", product_ids: { monthly: "oceancore_lite_monthly", yearly: "oceancore_lite_yearly" }, name: "OceanCore Lite", badge: "Low-cost starter", tagline: "Go ad-light and unlock basic AI", monthly_price_aud: 4.99, yearly_price_aud: 39.99, price_label: "A$4.99/mo", ads_enabled: false, rewarded_ads_allowed: true, ai_daily_limit: 25, saved_area_limit: 12, catch_card_level: "standard", catch_log: "unlimited", ai: "basic/limited", live_zones: false, delayed_zones: true, game_access: "basic", rewards: "basic", crew: false, features: ["No banner ads", "Unlimited catch log", "Basic AI assistant", "Limited AI predictions", "Basic weather/tide tools", "Basic size/legal info", "Basic OceanCore Offshore access", "Delayed fishing zones", "Community Lite badge", "Private catch history"], excluded_features: ["Full live fishing zones", "Full AI pattern memory", "Advanced trip predictions", "Crew sharing", "Premium rewards", "Creator tools"] },
  premium: { key: "premium", product_ids: { monthly: "oceancore_premium_monthly", yearly: "oceancore_premium_yearly" }, name: "OceanCore Premium", badge: "Most Popular", tagline: "Unlock the full OceanCore fishing brain", monthly_price_aud: 12.99, yearly_price_aud: 99.99, price_label: "A$12.99/mo", ads_enabled: false, ai_daily_limit: 9999, saved_area_limit: 9999, catch_card_level: "advanced", catch_log: "unlimited", ai: "full", live_zones: true, delayed_zones: true, game_access: "full", rewards: "premium", crew: false, features: ["Everything in Lite", "Full AI fishing assistant", "Full personal catch memory", "Live OceanCore fishing zones", "Best time/species predictions", "Advanced tide/wind/moon pattern analysis", "AI trip planner", "Full OceanCore Offshore access", "Premium game events", "Voucher/giveaway access", "Advanced catch stats"] },
  crew: { key: "crew", product_ids: { monthly: "oceancore_crew_monthly", yearly: "oceancore_crew_yearly" }, name: "OceanCore Crew", tagline: "For boats, families and fishing mates", monthly_price_aud: 24.99, yearly_price_aud: 219.99, price_label: "A$24.99/mo", ads_enabled: false, ai_daily_limit: 9999, saved_area_limit: 9999, catch_card_level: "crew", catch_log: "unlimited", ai: "full", live_zones: true, delayed_zones: true, game_access: "full", rewards: "crew/premium", crew: true, users_included: "3 to 5", features: ["Everything in Premium", "3 to 5 users included", "Shared boat profile", "Shared catch log", "Shared trip history", "Shared private marks", "Crew leaderboard", "Shared OceanCore Offshore rewards", "Shared trip planning", "Crew badge"] },
  founder: { key: "founder", name: "Founder", price_label: "Internal", ads_enabled: false, ai_daily_limit: 9999, saved_area_limit: 9999, catch_card_level: "founder", catch_log: "unlimited", ai: "full", live_zones: true, delayed_zones: true, game_access: "full", rewards: "crew/premium", crew: true, users_included: "3 to 5", features: ["Full access", "Admin/founder controls", "No ads", "All beta features"] },
};

const PUBLIC_PLAN_ORDER: PlanKey[] = ["free", "lite", "premium", "crew"];
const PAID_PLAN_KEYS: PlanKey[] = ["lite", "premium", "crew"];

function normalizePlanKey(plan: any): PlanKey {
  const p = String(plan || "free").toLowerCase();
  if (p === "starter") return "lite";
  if (p === "basic" || p === "pro") return "premium";
  if (p === "lite" || p === "premium" || p === "crew" || p === "founder") return p as PlanKey;
  return "free";
}

function publicPlanCatalog() {
  return Object.fromEntries(PUBLIC_PLAN_ORDER.map((key) => [key, PLAN_CATALOG[key]]));
}

function isPaidStatus(status: any) {
  const s = String(status || "").toLowerCase();
  return ["active", "trial", "trialing"].includes(s);
}

function effectivePlanFromProfile(profile: any = {}): PlanKey {
  const appRole = String(profile.app_role || "").toLowerCase();
  const plan = normalizePlanKey(profile.plan);
  const status = String(profile.subscription_status || "none").toLowerCase();
  if (appRole === "admin" || appRole === "founder" || plan === "founder") return "founder";

  // Beta mode: lets you manually assign Lite/Premium/Crew in Admin without Stripe.
  // When Stripe goes live, set BETA_MANUAL_PLAN_ACCESS=false if you want paid plans
  // to require subscription_status active/trial.
  if (BETA_MANUAL_PLAN_ACCESS && PAID_PLAN_KEYS.includes(plan)) return plan;

  if (PAID_PLAN_KEYS.includes(plan) && isPaidStatus(status)) return plan;
  return "free";
}

function getPlanEntitlements(profile: any = {}) {
  const effective_plan = effectivePlanFromProfile(profile);
  const base = PLAN_CATALOG[effective_plan] || PLAN_CATALOG.free;
  return { effective_plan, ads_enabled: base.ads_enabled, rewarded_ads_allowed: !!base.rewarded_ads_allowed, ai_daily_limit: base.ai_daily_limit, saved_area_limit: base.saved_area_limit, catch_card_level: base.catch_card_level, catch_log: base.catch_log, ai: base.ai, live_zones: !!base.live_zones, delayed_zones: !!base.delayed_zones, game_access: base.game_access, rewards: base.rewards, crew: !!base.crew, users_included: base.users_included || null, features: base.features };
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
  const p = normalizePlanKey(plan);
  const i = String(interval || "monthly").toLowerCase();
  if (p === "lite" && i === "yearly") return STRIPE_PRICE_LITE_YEARLY;
  if (p === "lite") return STRIPE_PRICE_LITE_MONTHLY;
  if (p === "premium" && i === "yearly") return STRIPE_PRICE_PREMIUM_YEARLY;
  if (p === "premium") return STRIPE_PRICE_PREMIUM_MONTHLY;
  if (p === "crew" && i === "yearly") return STRIPE_PRICE_CREW_YEARLY;
  if (p === "crew") return STRIPE_PRICE_CREW_MONTHLY;
  return "";
}

function stripePlanFromPrice(priceId: string) {
  if (!priceId) return "free";
  if ([STRIPE_PRICE_LITE_MONTHLY, STRIPE_PRICE_LITE_YEARLY].includes(priceId)) return "lite";
  if ([STRIPE_PRICE_PREMIUM_MONTHLY, STRIPE_PRICE_PREMIUM_YEARLY].includes(priceId)) return "premium";
  if ([STRIPE_PRICE_CREW_MONTHLY, STRIPE_PRICE_CREW_YEARLY].includes(priceId)) return "crew";
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
  const plan = normalizePlanKey(patch.plan);
  const catalog = (PLAN_CATALOG as any)[plan] || null;
  const enriched = { ...patch, plan, ...(catalog ? { ads_enabled: catalog.ads_enabled, ai_daily_limit: catalog.ai_daily_limit, saved_area_limit: catalog.saved_area_limit, catch_card_level: catalog.catch_card_level } : {}), updated_at: new Date().toISOString() };
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

function stripePricesConfigured() {
  return {
    lite_monthly: !!STRIPE_PRICE_LITE_MONTHLY,
    lite_yearly: !!STRIPE_PRICE_LITE_YEARLY,
    premium_monthly: !!STRIPE_PRICE_PREMIUM_MONTHLY,
    premium_yearly: !!STRIPE_PRICE_PREMIUM_YEARLY,
    crew_monthly: !!STRIPE_PRICE_CREW_MONTHLY,
    crew_yearly: !!STRIPE_PRICE_CREW_YEARLY,
  };
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

app.get("/billing/plans", async (_req, reply) => { ok(reply, { success: true, plans: publicPlanCatalog(), plan_order: PUBLIC_PLAN_ORDER, stripe_configured: !!STRIPE_SECRET_KEY, prices_configured: stripePricesConfigured() }); });

app.get("/billing/me", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const profile = await getBillingProfile(user); const entitlements = getPlanEntitlements(profile); const ai_usage = await getAiUsageStatus(user, profile).catch(() => null); ok(reply, { success: true, user: { id: user.id, email: user.email }, profile, entitlements, ai_usage, beta_manual_plan_access: BETA_MANUAL_PLAN_ACCESS, stripe_configured: !!STRIPE_SECRET_KEY, prices_configured: stripePricesConfigured(), plans: publicPlanCatalog(), plan_order: PUBLIC_PLAN_ORDER }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });
app.get("/billing/usage", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const profile = await getBillingProfile(user); const ai_usage = await getAiUsageStatus(user, profile); ok(reply, { success: true, ai_usage, entitlements: ai_usage.entitlements }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });

app.post("/billing/checkout", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const body = (req.body || {}) as any; const plan = normalizePlanKey(body.plan); const interval = String(body.interval || "monthly").toLowerCase() as BillingInterval; if (!PAID_PLAN_KEYS.includes(plan)) throw new Error("Choose Lite, Premium or Crew plan."); const priceId = stripePriceFor(plan, interval); if (!priceId) throw new Error(`Stripe price ID missing for ${plan} ${interval}. Add the new OceanCore price IDs to backend .env.`); const profile = await getBillingProfile(user); const base = getFrontendBaseUrl(req); const params: Record<string, any> = { mode: "subscription", "line_items[0][price]": priceId, "line_items[0][quantity]": 1, success_url: `${base}/?billing=success&plan=${encodeURIComponent(plan)}`, cancel_url: `${base}/?billing=cancelled`, client_reference_id: user.id, "metadata[user_id]": user.id, "metadata[email]": user.email || "", "metadata[plan]": plan, "metadata[interval]": interval, "metadata[product_id]": PLAN_CATALOG[plan]?.product_ids?.[interval] || "", "subscription_data[metadata][user_id]": user.id, "subscription_data[metadata][email]": user.email || "", "subscription_data[metadata][plan]": plan, "subscription_data[metadata][interval]": interval, "subscription_data[metadata][product_id]": PLAN_CATALOG[plan]?.product_ids?.[interval] || "", allow_promotion_codes: "true" }; if (profile.stripe_customer_id) params.customer = profile.stripe_customer_id; else if (user.email) params.customer_email = user.email; const session = await stripeRequest("/checkout/sessions", params); ok(reply, { success: true, url: session.url, id: session.id, product_id: PLAN_CATALOG[plan]?.product_ids?.[interval] || null }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });

app.post("/billing/portal", async (req, reply) => { try { const user = await getRequiredAuthUser(req); const profile = await getBillingProfile(user); if (!profile.stripe_customer_id) throw new Error("No Stripe customer found yet. Upgrade first, then billing portal will be available."); const base = getFrontendBaseUrl(req); const session = await stripeRequest("/billing_portal/sessions", { customer: profile.stripe_customer_id, return_url: `${base}/?billing=portal` }); ok(reply, { success: true, url: session.url }); } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); } });

app.post("/stripe/webhook", async (req: any, reply) => { try { const rawBody = String(req.rawBody || JSON.stringify(req.body || {})); const sig = String(req.headers?.["stripe-signature"] || ""); if (!verifyStripeWebhookSignature(rawBody, sig)) { reply.code(400).send({ success: false, error: "Invalid Stripe signature" }); return; } const event = req.body || {}; const type = String(event.type || ""); const obj = event.data?.object || {}; if (type === "checkout.session.completed") { const userId = String(obj.metadata?.user_id || obj.client_reference_id || ""); const plan = normalizePlanKey(obj.metadata?.plan || "free"); if (userId && PAID_PLAN_KEYS.includes(plan)) { await updateBillingFields(userId, { plan, subscription_status: "active", stripe_customer_id: obj.customer || null, stripe_subscription_id: obj.subscription || null }); } } if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(type)) { const customerId = String(obj.customer || ""); const userId = String(obj.metadata?.user_id || "") || await findUserIdByStripeCustomer(customerId); if (userId) { let plan = normalizePlanKey(obj.metadata?.plan || ""); if (!PAID_PLAN_KEYS.includes(plan)) plan = normalizePlanKey(stripePlanFromPrice(String(obj.items?.data?.[0]?.price?.id || ""))); const isDeleted = type === "customer.subscription.deleted"; const status = isDeleted ? "cancelled" : stripeStatusToAppStatus(obj.status || "none"); await updateBillingFields(userId, { plan: isDeleted ? "free" : plan, subscription_status: status, stripe_customer_id: customerId || null, stripe_subscription_id: obj.id || null, subscription_current_period_end: obj.current_period_end ? new Date(Number(obj.current_period_end) * 1000).toISOString() : null, subscription_cancel_at_period_end: !!obj.cancel_at_period_end }); } } ok(reply, { received: true }); } catch (e) { fail(reply, e, 400); } });

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
  const planKey = normalizePlanKey(patch.plan);
  const planDefaults = (PLAN_CATALOG as any)[planKey] || null;
  const enrichedPatch = {
    ...patch,
    plan: planKey,
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
    stripe_prices_configured: stripePricesConfigured(),
    admin_enabled: ADMIN_EMAILS.length > 0 || ADMIN_USER_IDS.length > 0,
    tables: {
      profiles: PROFILES_TABLE,
      catches: CATCHES_TABLE,
      feedback: FEEDBACK_TABLE,
      audit: AUDIT_TABLE,
      usage: USAGE_TABLE,
      saved_areas: SAVED_AREAS_TABLE,
      community_posts: COMMUNITY_POSTS_TABLE,
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

// ============================================================
// Community - real feed storage, media upload, and filters
// ============================================================
const COMMUNITY_POST_SELECT =
  "id,user_id,user_email,author_name,title,species,general_area,caption,category,post_type,topic,bait,conditions,length_cm,weight_kg,tags,poll_question,poll_options,privacy,media_url,media_mime,media_type,allow_comments,comment_permission,hold_link_comments,blocked_words,upload_quality,status,likes_count,comments_count,created_at,updated_at";
const COMMUNITY_COMMENT_SELECT =
  "id,post_id,user_id,user_email,author_name,body,status,created_at,updated_at";
const COMMUNITY_REPORT_SELECT =
  "id,post_id,user_id,user_email,reason,notes,status,created_at,updated_at";

function normalizeCommunityCategory(input: any, fallbackText = "") {
  const raw = str(input, "").toLowerCase();
  if (["following", "local", "trending", "videos", "boats", "offshore", "freshwater", "camping"].includes(raw)) return raw;
  const text = fallbackText.toLowerCase();
  if (/(boat|outboard|sounder|electronics|motor|trailer|modification|build)/i.test(text)) return "boats";
  if (/(offshore|reef|pelagic|tuna|marlin|mahi|deep sea)/i.test(text)) return "offshore";
  if (/(freshwater|dam|river|bass|cod|barramundi)/i.test(text)) return "freshwater";
  if (/(camping|4wd|four wheel|caravan|swag)/i.test(text)) return "camping";
  return "local";
}

function normalizeCommunityPostType(input: any, mediaType = "") {
  const raw = str(input, "").toLowerCase().replace(/\s+/g, "_");
  if (["fishing_report", "catch", "video", "boat", "discussion", "poll"].includes(raw)) return raw;
  if (mediaType === "video") return "video";
  return "discussion";
}

function normalizeCommunityTags(input: any) {
  const values = Array.isArray(input) ? input : str(input, "").split(",");
  return values.map((value) => str(value, "").toLowerCase().replace(/[^a-z0-9& -]/g, "").trim()).filter(Boolean).slice(0, 8);
}

function normalizePollOptions(input: any) {
  const values = Array.isArray(input) ? input : [];
  return values
    .map((value: any, index: number) => typeof value === "string"
      ? { id: `option-${index + 1}`, label: str(value, "").slice(0, 120), votes: 0 }
      : { id: str(value?.id, `option-${index + 1}`).slice(0, 80), label: str(value?.label, "").slice(0, 120), votes: Number(value?.votes || 0) })
    .filter((value: any) => value.label)
    .slice(0, 6);
}

function normalizeCommunityPrivacy(input: any) {
  const raw = str(input, "public").toLowerCase();
  return ["public", "area_only", "private"].includes(raw) ? raw : "public";
}

function normalizeCommunityCommentPermission(input: any) {
  const raw = str(input, "everyone").toLowerCase();
  return ["everyone", "followers", "off"].includes(raw) ? raw : "everyone";
}

function normalizeCommunityUploadQuality(input: any) {
  const raw = str(input, "hd").toLowerCase();
  return ["data_saver", "standard", "hd"].includes(raw) ? raw : "hd";
}

function normalizeBlockedWords(input: any) {
  const words = Array.isArray(input)
    ? input
    : str(input, "")
        .split(/[\n,]/)
        .map((word) => word.trim());

  return words
    .map((word) => str(word, "").toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, "").trim())
    .filter((word) => word.length >= 2)
    .slice(0, 80)
    .join(", ");
}

function communityBlockedWordsList(post: CommunityPostRow) {
  return str(post.blocked_words, "")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
}

function communityCommentStatusFor(post: CommunityPostRow, body: string) {
  if (post.allow_comments === false || post.comment_permission === "off") {
    throw uploadError("Comments are turned off for this post.", 403);
  }

  const lower = body.toLowerCase();
  const hasLink = /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})(?:\S*)/i.test(body);
  const blocked = communityBlockedWordsList(post).some((word) => lower.includes(word));
  if ((post.hold_link_comments && hasLink) || blocked) return "held";
  return "active";
}

function normalizeCommunityPost(row: any = {}): CommunityPostRow {
  const caption = str(row.caption, "").slice(0, 2200);
  const species = str(row.species, "").slice(0, 100) || null;
  const title = str(row.title, species || "OceanCore update").slice(0, 140);
  const category = normalizeCommunityCategory(row.category, `${title} ${caption} ${row.general_area || ""}`);
  const created = row.created_at || new Date().toISOString();
  const commentPermission = normalizeCommunityCommentPermission(row.comment_permission);
  const allowComments = row.allow_comments == null ? commentPermission !== "off" : !!row.allow_comments;
  const mediaType = str(row.media_type, "").slice(0, 20) || null;
  const postType = normalizeCommunityPostType(row.post_type, mediaType || "");
  return {
    id: String(row.id || crypto.randomUUID()),
    user_id: row.user_id ?? null,
    user_email: row.user_email ?? null,
    author_name: str(row.author_name, row.user_email || "OceanCore fisher").slice(0, 100),
    title,
    species,
    general_area: str(row.general_area, "Spot Safe").slice(0, 140),
    caption,
    category,
    post_type: postType,
    topic: str(row.topic, "").slice(0, 100) || null,
    bait: str(row.bait, "").slice(0, 100) || null,
    conditions: str(row.conditions, "").slice(0, 300) || null,
    length_cm: round2(num(row.length_cm)),
    weight_kg: round2(num(row.weight_kg)),
    tags: normalizeCommunityTags(row.tags),
    poll_question: postType === "poll" ? str(row.poll_question, title).slice(0, 220) : null,
    poll_options: postType === "poll" ? normalizePollOptions(row.poll_options) : [],
    privacy: normalizeCommunityPrivacy(row.privacy),
    media_url: str(row.media_url, "") || null,
    media_mime: str(row.media_mime, "").slice(0, 80) || null,
    media_type: mediaType,
    allow_comments: allowComments,
    comment_permission: allowComments ? commentPermission : "off",
    hold_link_comments: row.hold_link_comments == null ? true : !!row.hold_link_comments,
    blocked_words: normalizeBlockedWords(row.blocked_words),
    upload_quality: normalizeCommunityUploadQuality(row.upload_quality),
    status: str(row.status, "active").slice(0, 30),
    likes_count: Number(row.likes_count || 0),
    comments_count: Number(row.comments_count || 0),
    created_at: created,
    updated_at: row.updated_at || created,
  };
}

function normalizeCommunityComment(row: any = {}): CommunityCommentRow {
  const created = row.created_at || new Date().toISOString();
  return {
    id: String(row.id || crypto.randomUUID()),
    post_id: String(row.post_id || ""),
    user_id: row.user_id ?? null,
    user_email: row.user_email ?? null,
    author_name: str(row.author_name, row.user_email || "OceanCore fisher").slice(0, 100),
    body: str(row.body, "").slice(0, 1000),
    status: str(row.status, "active").slice(0, 30),
    created_at: created,
    updated_at: row.updated_at || created,
  };
}

function normalizeCommunityReport(row: any = {}): CommunityReportRow {
  const created = row.created_at || new Date().toISOString();
  return {
    id: String(row.id || crypto.randomUUID()),
    post_id: String(row.post_id || ""),
    user_id: row.user_id ?? null,
    user_email: row.user_email ?? null,
    reason: str(row.reason, "report").slice(0, 80),
    notes: str(row.notes, "").slice(0, 1000) || null,
    status: str(row.status, "open").slice(0, 30),
    created_at: created,
    updated_at: row.updated_at || created,
  };
}

function communityPostVisibleToUser(post: CommunityPostRow, user: AuthUser) {
  if (post.status === "hidden" || post.status === "deleted") return false;
  return post.privacy !== "private" || post.user_id === user.id;
}

function communityPostMatchesFilter(post: CommunityPostRow, filter: string, followingIds: Set<string> = new Set()) {
  const tab = String(filter || "local").toLowerCase();
  if (tab === "following") return !!post.user_id && followingIds.has(post.user_id);
  if (tab === "trending") return true;
  if (tab === "videos") return post.post_type === "video" || post.media_type === "video";
  if (["boats", "offshore", "freshwater", "camping"].includes(tab)) return post.category === tab;
  return post.category === "local" || post.post_type === "fishing_report" || post.post_type === "catch";
}

async function getCommunityWriteUser(req: any): Promise<AuthUser> {
  return supabase ? getRequiredAuthUser(req) : getAuthUser(req);
}

async function readLocalCommunityPosts(): Promise<CommunityPostRow[]> {
  try {
    const raw = await fs.promises.readFile(COMMUNITY_POSTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const posts = Array.isArray(parsed) ? parsed.map(normalizeCommunityPost) : [];
    mem.communityPosts = posts;
    return posts;
  } catch {
    return mem.communityPosts;
  }
}

const satelliteHeatmapCache = new Map<string, { expiresAt: number; payload: any }>();

function satelliteTemplateUrl(template: string, lat: number, lng: number) {
  return template
    .replaceAll("{lat}", String(Number(lat.toFixed(4))))
    .replaceAll("{lng}", String(Number(lng.toFixed(4))))
    .replaceAll("{lon}", String(Number(lng.toFixed(4))));
}

async function fetchSatelliteValue(template: string, lat: number, lng: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, SATELLITE_TIMEOUT_MS));
  try {
    const res = await fetch(satelliteTemplateUrl(template, lat, lng), {
      headers: { Accept: "application/json", "User-Agent": "OceanCoreAI/1.0 satellite heatmap" },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`satellite request failed (${res.status})`);
    const json = text ? JSON.parse(text) : null;
    const rows = json?.table?.rows;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const values = Array.isArray(row) ? row : [];
        const lastNumber = [...values].reverse().find((value) => Number.isFinite(Number(value)));
        if (lastNumber != null) return Number(lastNumber);
      }
    }
    const flat = JSON.stringify(json || {}).match(/-?\d+(?:\.\d+)?/g) || [];
    const value = flat.map(Number).reverse().find((x) => Number.isFinite(x));
    return value ?? null;
  } finally {
    clearTimeout(timer);
  }
}

function kmOffsetLatLng(lat: number, lng: number, northKm: number, eastKm: number) {
  const dLat = northKm / 111.32;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = eastKm / Math.max(20, 111.32 * Math.max(0.18, Math.abs(cosLat)));
  return { lat: lat + dLat, lng: lng + dLng };
}

function satelliteSpeciesProfile(species: string) {
  const key = String(species || "pelagics").toLowerCase();
  if (/snapper|reef/.test(key)) return { family: "reef", sstMin: 18, sstMax: 25, sstIdeal: 21.5, chloroWeight: 0.9 };
  if (/flathead|whiting|bream/.test(key)) return { family: "inshore", sstMin: 18, sstMax: 28, sstIdeal: 23, chloroWeight: 0.6 };
  return { family: "pelagic", sstMin: 20, sstMax: 29, sstIdeal: 24, chloroWeight: 1.25 };
}

function scoreSatelliteCell(input: { species: string; sstC: number | null; chloroSignal: number | null; distanceKm: number }) {
  const profile = satelliteSpeciesProfile(input.species);
  let score = 38;
  const reasons: string[] = [];

  if (input.sstC == null) {
    reasons.push("SST missing");
  } else {
    const tempDistance = Math.abs(input.sstC - profile.sstIdeal);
    const tempScore = Math.max(-12, 28 - tempDistance * 8);
    score += tempScore;
    reasons.push(`SST ${Number(input.sstC.toFixed(1))}C`);
  }

  if (input.chloroSignal == null) {
    reasons.push("chlorophyll missing/cloud gap");
  } else {
    const productive = Math.max(-10, Math.min(20, input.chloroSignal * 12 * profile.chloroWeight));
    score += productive;
    reasons.push(`chlorophyll signal ${Number(input.chloroSignal.toFixed(2))}`);
  }

  score += Math.max(-8, 7 - input.distanceKm * 0.35);
  return { score: clamp(Math.round(score), 0, 100), reasons };
}

async function buildSatelliteHeatmap(input: { lat: number; lng: number; radiusKm: number; species: string }) {
  if (!SATELLITE_HEATMAP_ENABLED) throw new Error("Satellite heat map is disabled on this backend.");
  const radiusKm = clamp(Number(input.radiusKm || 35), 5, 120);
  const species = str(input.species || "pelagics", "pelagics").toLowerCase();
  const cacheKey = [input.lat.toFixed(2), input.lng.toFixed(2), radiusKm, species].join(":");
  const cached = satelliteHeatmapCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.payload, cached: true };

  const offsets = [-0.66, 0, 0.66];
  const cellRadiusKm = Math.max(3, radiusKm / 3.8);
  const cells = offsets.flatMap((north) =>
    offsets.map((east) => {
      const northKm = north * radiusKm;
      const eastKm = east * radiusKm;
      const point = kmOffsetLatLng(input.lat, input.lng, northKm, eastKm);
      return { ...point, northKm, eastKm, distanceKm: Math.sqrt(northKm ** 2 + eastKm ** 2) };
    })
  );

  const sampled = await Promise.all(cells.map(async (cell) => {
    const [sst, chloro] = await Promise.allSettled([
      fetchSatelliteValue(SATELLITE_SST_URL_TEMPLATE, cell.lat, cell.lng),
      fetchSatelliteValue(SATELLITE_CHLORO_URL_TEMPLATE, cell.lat, cell.lng),
    ]);
    const sstRaw = sst.status === "fulfilled" ? sst.value : null;
    const sstC = sstRaw != null && sstRaw > 100 ? sstRaw - 273.15 : sstRaw;
    const chloroSignal = chloro.status === "fulfilled" ? chloro.value : null;
    const hasSatelliteData = sstC != null || chloroSignal != null;
    const scored = hasSatelliteData
      ? scoreSatelliteCell({ species, sstC, chloroSignal, distanceKm: cell.distanceKm })
      : { score: null, reasons: ["No usable satellite SST/chlorophyll"] };
    return {
      lat: Number(cell.lat.toFixed(5)),
      lng: Number(cell.lng.toFixed(5)),
      radius_km: Number(cellRadiusKm.toFixed(1)),
      score: scored.score,
      sst_c: sstC == null ? null : Number(sstC.toFixed(2)),
      chlorophyll_signal: chloroSignal == null ? null : Number(chloroSignal.toFixed(4)),
      reasons: scored.reasons,
      source_status: sst.status === "fulfilled" || chloro.status === "fulfilled" ? "satellite_sampled" : "satellite_unavailable",
    };
  }));

  const usable = sampled.filter((cell) => cell.score != null && (cell.sst_c != null || cell.chlorophyll_signal != null));
  const bestCell = usable.slice().sort((a, b) => Number(b.score) - Number(a.score))[0] || null;
  const payload = {
    success: true,
    species,
    location: { lat: input.lat, lng: input.lng, radius_km: radiusKm },
    source_name: "NOAA CoastWatch ERDDAP satellite products",
    source_status: usable.length ? (usable.length === sampled.length ? "satellite_live" : "satellite_partial") : "satellite_unavailable",
    partial: usable.length !== sampled.length,
    data_quality: usable.length ? Math.round((usable.length / sampled.length) * 100) : 0,
    warning: usable.length
      ? "Satellite cells are sampled from public NOAA ERDDAP products. Cloud cover, latency and dataset gaps can reduce accuracy."
      : "Satellite provider did not return usable SST/chlorophyll cells for this area within the timeout.",
    layers: {
      sst: { configured: !!SATELLITE_SST_URL_TEMPLATE, provider: "NOAA/JPL MUR SST via ERDDAP" },
      chlorophyll: { configured: !!SATELLITE_CHLORO_URL_TEMPLATE, provider: "NOAA VIIRS chlorophyll anomaly via ERDDAP" },
    },
    sample_count: sampled.length,
    usable_cell_count: usable.length,
    cells: usable,
    best_cell: bestCell,
    cached: false,
  };
  satelliteHeatmapCache.set(cacheKey, { expiresAt: Date.now() + SATELLITE_CACHE_MS, payload });
  return payload;
}

async function writeLocalCommunityPosts(posts: CommunityPostRow[]) {
  mem.communityPosts = posts.slice(0, 200);
  await fs.promises.writeFile(COMMUNITY_POSTS_FILE, JSON.stringify(mem.communityPosts, null, 2), "utf8");
}

async function readLocalCommunityComments(): Promise<CommunityCommentRow[]> {
  try {
    const raw = await fs.promises.readFile(COMMUNITY_COMMENTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed.map(normalizeCommunityComment) : [];
    mem.communityComments = rows;
    return rows;
  } catch {
    return mem.communityComments;
  }
}

async function writeLocalCommunityComments(rows: CommunityCommentRow[]) {
  mem.communityComments = rows.slice(-1000);
  await fs.promises.writeFile(COMMUNITY_COMMENTS_FILE, JSON.stringify(mem.communityComments, null, 2), "utf8");
}

async function readLocalCommunityReports(): Promise<CommunityReportRow[]> {
  try {
    const raw = await fs.promises.readFile(COMMUNITY_REPORTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed.map(normalizeCommunityReport) : [];
    mem.communityReports = rows;
    return rows;
  } catch {
    return mem.communityReports;
  }
}

async function writeLocalCommunityReports(rows: CommunityReportRow[]) {
  mem.communityReports = rows.slice(-1000);
  await fs.promises.writeFile(COMMUNITY_REPORTS_FILE, JSON.stringify(mem.communityReports, null, 2), "utf8");
}

async function readLocalCommunityLikes() {
  try {
    const raw = await fs.promises.readFile(COMMUNITY_LIKES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [];
    mem.communityLikes = rows;
    return rows as typeof mem.communityLikes;
  } catch {
    return mem.communityLikes;
  }
}

async function writeLocalCommunityLikes(rows: typeof mem.communityLikes) {
  mem.communityLikes = rows.slice(-5000);
  await fs.promises.writeFile(COMMUNITY_LIKES_FILE, JSON.stringify(mem.communityLikes, null, 2), "utf8");
}

async function readLocalCommunityFollows() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(COMMUNITY_FOLLOWS_FILE, "utf8"));
    mem.communityFollows = Array.isArray(parsed) ? parsed : [];
  } catch {}
  return mem.communityFollows;
}

async function writeLocalCommunityFollows(rows: typeof mem.communityFollows) {
  mem.communityFollows = rows.slice(-10000);
  await fs.promises.writeFile(COMMUNITY_FOLLOWS_FILE, JSON.stringify(mem.communityFollows, null, 2), "utf8");
}

async function readLocalCommunityPollVotes() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(COMMUNITY_POLL_VOTES_FILE, "utf8"));
    mem.communityPollVotes = Array.isArray(parsed) ? parsed : [];
  } catch {}
  return mem.communityPollVotes;
}

async function writeLocalCommunityPollVotes(rows: typeof mem.communityPollVotes) {
  mem.communityPollVotes = rows.slice(-20000);
  await fs.promises.writeFile(COMMUNITY_POLL_VOTES_FILE, JSON.stringify(mem.communityPollVotes, null, 2), "utf8");
}

async function communityFollowingIds(userId: string) {
  if (supabase) {
    try {
      const res = await supabase.from("community_follows").select("following_id").eq("follower_id", userId);
      if (res.error) throw res.error;
      return new Set((res.data || []).map((row: any) => String(row.following_id)));
    } catch (e) {
      console.warn("community follows list failed, using local storage", e);
    }
  }
  return new Set((await readLocalCommunityFollows()).filter((row) => row.follower_id === userId).map((row) => row.following_id));
}

async function listCommunityPostsForUser(user: AuthUser, filter = ""): Promise<{ posts: CommunityPostRow[]; storage: string }> {
  const followingIds = filter === "following" ? await communityFollowingIds(user.id) : new Set<string>();
  const sortPosts = (posts: CommunityPostRow[]) => posts.sort((a, b) => filter === "trending"
    ? (Number(b.likes_count || 0) * 3 + Number(b.comments_count || 0) * 5) - (Number(a.likes_count || 0) * 3 + Number(a.comments_count || 0) * 5)
    : String(b.created_at).localeCompare(String(a.created_at)));
  if (supabase) {
    try {
      const res = await supabase
        .from(COMMUNITY_POSTS_TABLE)
        .select(COMMUNITY_POST_SELECT)
        .order("created_at", { ascending: false })
        .limit(100);
      if (res.error) throw res.error;
      return {
        posts: sortPosts((res.data || [])
          .map(normalizeCommunityPost)
          .filter((post) => communityPostVisibleToUser(post, user))
          .filter((post) => communityPostMatchesFilter(post, filter, followingIds))),
        storage: "supabase",
      };
    } catch (e) {
      console.warn("community posts supabase list failed, using local storage", e);
    }
  }

  const posts = await readLocalCommunityPosts();
  const comments = await readLocalCommunityComments();
  const likes = await readLocalCommunityLikes();
  return {
    posts: posts
      .map((post) => ({
        ...post,
        comments_count: comments.filter((row) => row.post_id === post.id && row.status === "active").length,
        likes_count: likes.filter((row) => row.post_id === post.id).length,
      }))
      .filter((post) => communityPostVisibleToUser(post, user))
      .filter((post) => communityPostMatchesFilter(post, filter, followingIds))
      .sort((a, b) => filter === "trending"
        ? (Number(b.likes_count || 0) * 3 + Number(b.comments_count || 0) * 5) - (Number(a.likes_count || 0) * 3 + Number(a.comments_count || 0) * 5)
        : String(b.created_at).localeCompare(String(a.created_at))),
    storage: "local",
  };
}

async function saveCommunityPost(row: CommunityPostRow): Promise<{ post: CommunityPostRow; storage: string }> {
  if (supabase) {
    try {
      const saved = await supabase
        .from(COMMUNITY_POSTS_TABLE)
        .insert(row)
        .select(COMMUNITY_POST_SELECT)
        .single();
      if (saved.error) throw saved.error;
      return { post: normalizeCommunityPost(saved.data), storage: "supabase" };
    } catch (e) {
      console.warn("community posts supabase insert failed, using local storage", e);
      if (IS_PRODUCTION) {
        throw uploadError("Community post could not be saved safely. Please try again shortly.", 503);
      }
    }
  }

  const posts = await readLocalCommunityPosts();
  posts.unshift(row);
  await writeLocalCommunityPosts(posts);
  return { post: row, storage: "local" };
}

function withPublicCommunityMedia(req: any, post: CommunityPostRow) {
  return {
    ...post,
    media_url: makeAbsoluteMediaUrl(req, post.media_url),
  };
}

async function communityPostsHandler(req: any, reply: any) {
  try {
    const user = await getAuthUser(req);
    const filter = str(req.query?.filter, "");
    const result = await listCommunityPostsForUser(user, filter);
    ok(reply, {
      success: true,
      posts: result.posts.map((post) => withPublicCommunityMedia(req, post)),
      storage: result.storage,
      filter: filter || "local",
      spot_safe: true,
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function createCommunityPostHandler(req: any, reply: any) {
  try {
    const user = await getCommunityWriteUser(req);
    const profile = await getProfileForUser(user).catch(() => null);
    const body = (req.body || {}) as any;
    const caption = str(body.caption, "").slice(0, 2200);
    const species = str(body.species, "").slice(0, 100);
    const mediaDataUrl = str(body.media_data_url, "");
    let mediaUrl = str(body.media_url, "");
    let mediaMime = str(body.media_mime, "").slice(0, 80);
    let mediaType = str(body.media_type, "").slice(0, 20);

    if (!caption && !species && !mediaDataUrl && !mediaUrl) {
      throw new Error("Add a caption, topic, photo, or video first.");
    }

    if (mediaDataUrl) {
      if (isDataUrlMedia(mediaDataUrl)) {
        const saved = await saveDataUrlMedia(mediaDataUrl);
        mediaUrl = saved.url;
        mediaMime = saved.mime;
        mediaType = saved.type;
      } else if (/^https:\/\//i.test(mediaDataUrl) || mediaDataUrl.startsWith("/media/")) {
        mediaUrl = mediaDataUrl;
      } else {
        throw new Error("Community media must be an image/video upload or an existing media URL.");
      }
    }

    if (mediaUrl && !/^https:\/\//i.test(mediaUrl) && !mediaUrl.startsWith("/media/")) {
      throw new Error("Community media URL must be an uploaded OceanCore file or an HTTPS URL.");
    }

    const authorName =
      str(body.author_name, "") ||
      str(profile?.full_name, "") ||
      str(profile?.username, "") ||
      str(user.email, "") ||
      "OceanCore fisher";
    const title = species || str(body.title, "") || (caption ? caption.split(/[.!?\n]/)[0] : "OceanCore update");
    const category = normalizeCommunityCategory(body.category, `${title} ${caption} ${body.general_area || ""}`);
    const generalArea = str(body.general_area, "Spot Safe").slice(0, 140);
    if (/^-?\d{1,3}\.\d{3,}\s*[,/]\s*-?\d{1,3}\.\d{3,}$/.test(generalArea.trim())) {
      throw uploadError("Exact GPS marks cannot be published. Choose a general area instead.", 400);
    }
    const commentPermission = normalizeCommunityCommentPermission(body.comment_permission);
    const allowComments = body.allow_comments == null ? commentPermission !== "off" : !!body.allow_comments;
    const now = new Date().toISOString();
    const row = normalizeCommunityPost({
      id: crypto.randomUUID(),
      user_id: user.id,
      user_email: user.email ?? null,
      author_name: authorName,
      title,
      species,
      general_area: generalArea,
      caption,
      category,
      post_type: normalizeCommunityPostType(body.post_type, mediaType),
      topic: body.topic,
      bait: body.bait,
      conditions: body.conditions,
      length_cm: body.length_cm,
      weight_kg: body.weight_kg,
      tags: body.tags,
      poll_question: body.poll_question,
      poll_options: body.poll_options,
      privacy: body.privacy,
      media_url: mediaUrl,
      media_mime: mediaMime,
      media_type: mediaType || (mediaMime.startsWith("video/") ? "video" : mediaMime ? "image" : ""),
      allow_comments: allowComments,
      comment_permission: allowComments ? commentPermission : "off",
      hold_link_comments: body.hold_link_comments == null ? true : !!body.hold_link_comments,
      blocked_words: normalizeBlockedWords(body.blocked_words),
      upload_quality: normalizeCommunityUploadQuality(body.upload_quality),
      likes_count: 0,
      comments_count: 0,
      created_at: now,
      updated_at: now,
    });

    const saved = await saveCommunityPost(row);
    const rewards = await awardRewardBatch(user, rewardEventsForCommunityPost(saved.post));
    ok(reply, {
      success: true,
      post: withPublicCommunityMedia(req, saved.post),
      storage: saved.storage,
      rewards,
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function findCommunityPostById(id: string): Promise<CommunityPostRow | null> {
  if (!id) return null;
  if (supabase) {
    try {
      const res = await supabase.from(COMMUNITY_POSTS_TABLE).select(COMMUNITY_POST_SELECT).eq("id", id).maybeSingle();
      if (res.error && (res.error as any)?.code !== "PGRST116") throw res.error;
      return res.data ? normalizeCommunityPost(res.data) : null;
    } catch (e) {
      console.warn("community post lookup failed, using local storage", e);
    }
  }
  const posts = await readLocalCommunityPosts();
  return posts.find((post) => post.id === id) || null;
}

async function communityLikeHandler(req: any, reply: any) {
  try {
    const user = await getCommunityWriteUser(req);
    const postId = str((req.params as any)?.id);
    const post = await findCommunityPostById(postId);
    if (!post || post.status === "deleted") throw new Error("Community post not found.");

    let liked = true;
    let likesCount = 0;
    if (supabase) {
      try {
        const existing = await supabase.from("community_likes").select("post_id,user_id").eq("post_id", postId).eq("user_id", user.id).maybeSingle();
        if (existing.data) {
          await supabase.from("community_likes").delete().eq("post_id", postId).eq("user_id", user.id);
          liked = false;
        } else {
          const inserted = await supabase.from("community_likes").insert({ post_id: postId, user_id: user.id, user_email: user.email ?? null, created_at: new Date().toISOString() });
          if (inserted.error) throw inserted.error;
        }
        const countRes = await supabase.from("community_likes").select("post_id", { count: "exact", head: true }).eq("post_id", postId);
        likesCount = Number(countRes.count || 0);
        await supabase.from(COMMUNITY_POSTS_TABLE).update({ likes_count: likesCount, updated_at: new Date().toISOString() }).eq("id", postId);
        const rewards = liked ? await awardCommunityLikeMilestones(post, likesCount) : [];
        ok(reply, { success: true, liked, likes_count: likesCount, rewards });
        return;
      } catch (e) {
        console.warn("community like supabase failed, using local storage", e);
      }
    }

    const likes = await readLocalCommunityLikes();
    const idx = likes.findIndex((row) => row.post_id === postId && row.user_id === user.id);
    if (idx >= 0) {
      likes.splice(idx, 1);
      liked = false;
    } else {
      likes.push({ post_id: postId, user_id: user.id, user_email: user.email ?? null, created_at: new Date().toISOString() });
    }
    await writeLocalCommunityLikes(likes);
    likesCount = likes.filter((row) => row.post_id === postId).length;
    const posts = await readLocalCommunityPosts();
    const postIdx = posts.findIndex((row) => row.id === postId);
    if (postIdx >= 0) {
      posts[postIdx].likes_count = likesCount;
      posts[postIdx].updated_at = new Date().toISOString();
      await writeLocalCommunityPosts(posts);
    }
    const rewards = liked ? await awardCommunityLikeMilestones(post, likesCount) : [];
    ok(reply, { success: true, liked, likes_count: likesCount, rewards });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function communityCommentsHandler(req: any, reply: any) {
  try {
    const user = await getAuthUser(req);
    const postId = str((req.params as any)?.id);
    const post = await findCommunityPostById(postId);
    if (!post || !communityPostVisibleToUser(post, user)) throw new Error("Community post not found.");
    if (supabase) {
      try {
        const res = await supabase
          .from("community_comments")
          .select(COMMUNITY_COMMENT_SELECT)
          .eq("post_id", postId)
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(100);
        if (res.error) throw res.error;
        ok(reply, { success: true, comments: (res.data || []).map(normalizeCommunityComment) });
        return;
      } catch (e) {
        console.warn("community comments supabase list failed, using local storage", e);
      }
    }
    const rows = await readLocalCommunityComments();
    ok(reply, { success: true, comments: rows.filter((row) => row.post_id === postId && row.status === "active") });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function createCommunityCommentHandler(req: any, reply: any) {
  try {
    const user = await getCommunityWriteUser(req);
    const profile = await getProfileForUser(user).catch(() => null);
    const postId = str((req.params as any)?.id);
    const post = await findCommunityPostById(postId);
    if (!post || post.status === "deleted") throw new Error("Community post not found.");
    const body = str((req.body as any)?.body, "").slice(0, 1000);
    if (body.length < 2) throw new Error("Write a comment first.");
    const now = new Date().toISOString();
    const commentStatus = communityCommentStatusFor(post, body);
    const row = normalizeCommunityComment({
      id: crypto.randomUUID(),
      post_id: postId,
      user_id: user.id,
      user_email: user.email ?? null,
      author_name: str(profile?.full_name, "") || str(profile?.username, "") || str(user.email, "") || "OceanCore fisher",
      body,
      status: commentStatus,
      created_at: now,
      updated_at: now,
    });

    if (supabase) {
      try {
        const saved = await supabase.from("community_comments").insert(row).select(COMMUNITY_COMMENT_SELECT).single();
        if (saved.error) throw saved.error;
        const countRes = await supabase.from("community_comments").select("id", { count: "exact", head: true }).eq("post_id", postId).eq("status", "active");
        await supabase.from(COMMUNITY_POSTS_TABLE).update({ comments_count: Number(countRes.count || 0), updated_at: now }).eq("id", postId);
        const rewards = commentStatus === "active"
          ? await awardRewardBatch(user, [{
              type: "community_comment_created",
              key: `community-comment:${row.id}:created`,
              sourceType: "community_comment",
              sourceId: row.id,
            }])
          : [];
        ok(reply, {
          success: true,
          comment: normalizeCommunityComment(saved.data),
          comments_count: Number(countRes.count || 0),
          held_for_review: commentStatus !== "active",
          rewards,
        });
        return;
      } catch (e) {
        console.warn("community comment supabase insert failed, using local storage", e);
      }
    }

    const rows = await readLocalCommunityComments();
    rows.push(row);
    await writeLocalCommunityComments(rows);
    const commentsCount = rows.filter((x) => x.post_id === postId && x.status === "active").length;
    const posts = await readLocalCommunityPosts();
    const idx = posts.findIndex((x) => x.id === postId);
    if (idx >= 0) {
      posts[idx].comments_count = commentsCount;
      posts[idx].updated_at = now;
      await writeLocalCommunityPosts(posts);
    }
    const rewards = commentStatus === "active"
      ? await awardRewardBatch(user, [{
          type: "community_comment_created",
          key: `community-comment:${row.id}:created`,
          sourceType: "community_comment",
          sourceId: row.id,
        }])
      : [];
    ok(reply, { success: true, comment: row, comments_count: commentsCount, held_for_review: commentStatus !== "active", rewards });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function reportCommunityPostHandler(req: any, reply: any) {
  try {
    const user = await getCommunityWriteUser(req);
    const postId = str((req.params as any)?.id);
    const post = await findCommunityPostById(postId);
    if (!post || post.status === "deleted") throw new Error("Community post not found.");
    const now = new Date().toISOString();
    const row = normalizeCommunityReport({
      id: crypto.randomUUID(),
      post_id: postId,
      user_id: user.id,
      user_email: user.email ?? null,
      reason: str((req.body as any)?.reason, "report"),
      notes: str((req.body as any)?.notes, ""),
      status: "open",
      created_at: now,
      updated_at: now,
    });
    if (supabase) {
      try {
        const saved = await supabase.from("community_reports").insert(row).select(COMMUNITY_REPORT_SELECT).single();
        if (saved.error) throw saved.error;
        ok(reply, { success: true, report: normalizeCommunityReport(saved.data) });
        return;
      } catch (e) {
        console.warn("community report supabase insert failed, using local storage", e);
      }
    }
    const rows = await readLocalCommunityReports();
    rows.push(row);
    await writeLocalCommunityReports(rows);
    ok(reply, { success: true, report: row });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function deleteCommunityPostHandler(req: any, reply: any) {
  try {
    const user = await getCommunityWriteUser(req);
    const postId = str((req.params as any)?.id);
    const post = await findCommunityPostById(postId);
    if (!post) throw new Error("Community post not found.");
    if (post.user_id !== user.id && !isAdminUser(user)) throw adminError("You can only delete your own community posts.", 403);
    const patch = { status: "deleted", updated_at: new Date().toISOString() };
    if (supabase) {
      try {
        const saved = await supabase.from(COMMUNITY_POSTS_TABLE).update(patch).eq("id", postId).select(COMMUNITY_POST_SELECT).maybeSingle();
        if (saved.error && (saved.error as any)?.code !== "PGRST116") throw saved.error;
        ok(reply, { success: true, deleted: !!saved.data });
        return;
      } catch (e) {
        console.warn("community delete supabase failed, using local storage", e);
      }
    }
    const posts = await readLocalCommunityPosts();
    const idx = posts.findIndex((row) => row.id === postId);
    if (idx >= 0) {
      posts[idx] = normalizeCommunityPost({ ...posts[idx], ...patch });
      await writeLocalCommunityPosts(posts);
    }
    ok(reply, { success: true, deleted: idx >= 0 });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function adminCommunityPostsHandler(req: any, reply: any) {
  try {
    const admin = await requireAdminUser(req);
    const result = await listCommunityPostsForUser(admin, "");
    const reports = supabase
      ? await supabase.from("community_reports").select(COMMUNITY_REPORT_SELECT).order("created_at", { ascending: false }).limit(200).then((r) => r.data || []).catch(() => [])
      : await readLocalCommunityReports();
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, posts: result.posts.map((post) => withPublicCommunityMedia(req, post)), reports, storage: result.storage });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function adminUpdateCommunityPostHandler(req: any, reply: any) {
  try {
    const admin = await requireAdminUser(req);
    const postId = str((req.params as any)?.id);
    const status = str((req.body as any)?.status, "active").toLowerCase();
    if (!["active", "hidden", "deleted"].includes(status)) throw new Error("Status must be active, hidden, or deleted.");
    const patch = { status, updated_at: new Date().toISOString() };
    if (supabase) {
      const saved = await supabase.from(COMMUNITY_POSTS_TABLE).update(patch).eq("id", postId).select(COMMUNITY_POST_SELECT).maybeSingle();
      if (saved.error && (saved.error as any)?.code !== "PGRST116") throw saved.error;
      await writeAuditLog(admin, "community_post_status_updated", "community_post", postId, patch);
      ok(reply, { success: true, post: saved.data ? normalizeCommunityPost(saved.data) : null });
      return;
    }
    const posts = await readLocalCommunityPosts();
    const idx = posts.findIndex((row) => row.id === postId);
    if (idx >= 0) posts[idx] = normalizeCommunityPost({ ...posts[idx], ...patch });
    await writeLocalCommunityPosts(posts);
    await writeAuditLog(admin, "community_post_status_updated", "community_post", postId, patch);
    ok(reply, { success: true, post: idx >= 0 ? posts[idx] : null });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

function safetyWords(text: string) {
  const lower = String(text || "").toLowerCase();
  const matches: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["exact_location_risk", /\b(?:gps|coordinates?|mark|spot|pin|lat|lng|longitude|latitude)\b/i],
    ["harassment_or_abuse", /\b(?:idiot|stupid|hate|kill|threat|fight|abuse)\b/i],
    ["spam_or_scam", /\b(?:crypto|telegram|whatsapp|free money|investment|click here|http:\/\/|https:\/\/|www\.)\b/i],
    ["illegal_or_unsafe", /\b(?:undersize|illegal|poach|no limit|closed season|drink drive|unsafe|hazard|danger)\b/i],
  ];
  for (const [label, pattern] of checks) if (pattern.test(lower)) matches.push(label);
  return [...new Set(matches)];
}

function buildAdminSafetyFlag(source: string, id: string, text: string, extra: Record<string, any> = {}) {
  const reasons = safetyWords(text);
  if (!reasons.length && !extra.reported) return null;
  const severity = reasons.includes("harassment_or_abuse") || reasons.includes("illegal_or_unsafe")
    ? "high"
    : reasons.includes("exact_location_risk") || extra.reported
    ? "medium"
    : "low";
  return {
    id: `${source}:${id}`,
    source,
    source_id: id,
    severity,
    reasons,
    text: String(text || "").slice(0, 260),
    ...extra,
  };
}

async function listAdminCommunityComments(limit = 300) {
  if (!supabase) return (await readLocalCommunityComments()).slice(-limit).reverse();
  try {
    const res = await supabase
      .from("community_comments")
      .select(COMMUNITY_COMMENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (res.error) throw res.error;
    return (res.data || []).map(normalizeCommunityComment);
  } catch (e) {
    console.warn("admin community comments list failed", e);
    return [];
  }
}

async function listAdminCommunityFollows(limit = 500) {
  if (!supabase) return (await readLocalCommunityFollows()).slice(-limit).reverse();
  try {
    const res = await supabase
      .from("community_follows")
      .select("follower_id,following_id,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (res.error) throw res.error;
    return res.data || [];
  } catch (e) {
    console.warn("admin community follows list failed", e);
    return [];
  }
}

async function adminSupportCenterHandler(req: any, reply: any) {
  try {
    const admin = await requireAdminUser(req);
    const data = await getAdminData(1000);
    const [feedback, audit, community, comments, reports, follows] = await Promise.all([
      listFeedbackRows(300),
      listAuditRows(150),
      listCommunityPostsForUser(admin, "").catch(() => ({ posts: [] as CommunityPostRow[], storage: "unavailable" })),
      listAdminCommunityComments(300),
      supabase
        ? supabase.from("community_reports").select(COMMUNITY_REPORT_SELECT).order("created_at", { ascending: false }).limit(300).then((r) => (r.data || []).map(normalizeCommunityReport)).catch(() => [])
        : readLocalCommunityReports(),
      listAdminCommunityFollows(500),
    ]);

    const profilesById = new Map((data.profiles || []).map((profile: any) => [String(profile.id), profile]));
    const usersById = new Map((data.users || []).map((user: any) => [String(user.id), user]));
    const posts = community.posts || [];
    const postsById = new Map(posts.map((post) => [String(post.id), post]));
    const openFeedback = feedback.filter((row: any) => String(row.status || "open") !== "closed");
    const reportedPostIds = new Set(reports.filter((row: any) => String(row.status || "open") !== "closed").map((row: any) => String(row.post_id)));

    const safetyFlags = [
      ...posts.map((post) => buildAdminSafetyFlag("post", String(post.id), `${post.title || ""} ${post.caption || ""} ${post.general_area || ""}`, {
        user_id: post.user_id,
        user_email: post.user_email,
        status: post.status,
        reported: reportedPostIds.has(String(post.id)),
        created_at: post.created_at,
      })).filter(Boolean),
      ...comments.map((comment) => buildAdminSafetyFlag("comment", String(comment.id), comment.body, {
        post_id: comment.post_id,
        user_id: comment.user_id,
        user_email: comment.user_email,
        status: comment.status,
        created_at: comment.created_at,
      })).filter(Boolean),
    ].sort((a: any, b: any) => {
      const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      return (rank[b.severity] || 0) - (rank[a.severity] || 0) || Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || ""));
    });

    const supportCases = openFeedback.slice(0, 100).map((row: any) => {
      const userId = String(row.user_id || "");
      const email = String(row.user_email || "");
      const profile = profilesById.get(userId) || [...profilesById.values()].find((p: any) => String(p.email || "").toLowerCase() === email.toLowerCase()) || null;
      const authUser = usersById.get(userId) || [...usersById.values()].find((u: any) => String(u.email || "").toLowerCase() === email.toLowerCase()) || null;
      return {
        id: row.id,
        type: row.type,
        status: row.status || "open",
        priority: /upload|login|payment|delete|unsafe|abuse|video/i.test(`${row.type} ${row.message}`) ? "high" : "normal",
        user_id: row.user_id || profile?.id || authUser?.id || null,
        user_email: row.user_email || profile?.email || authUser?.email || null,
        profile_name: profile?.full_name || profile?.username || null,
        message: row.message,
        page: row.page,
        created_at: row.created_at,
        last_sign_in_at: authUser?.last_sign_in_at || null,
        account_status: profile?.account_status || "active",
        plan: profile?.plan || "free",
      };
    });

    const followerCounts = new Map<string, { user_id: string; followers: number; following: number }>();
    for (const row of follows as any[]) {
      const followerId = String(row.follower_id || "");
      const followingId = String(row.following_id || "");
      if (followerId) {
        const entry = followerCounts.get(followerId) || { user_id: followerId, followers: 0, following: 0 };
        entry.following += 1;
        followerCounts.set(followerId, entry);
      }
      if (followingId) {
        const entry = followerCounts.get(followingId) || { user_id: followingId, followers: 0, following: 0 };
        entry.followers += 1;
        followerCounts.set(followingId, entry);
      }
    }

    const socialGraph = [...followerCounts.values()]
      .map((row) => {
        const profile = profilesById.get(row.user_id) as any;
        const user = usersById.get(row.user_id) as any;
        return {
          ...row,
          email: profile?.email || user?.email || null,
          name: profile?.full_name || profile?.username || user?.email || row.user_id,
          account_status: profile?.account_status || "active",
        };
      })
      .sort((a, b) => b.followers - a.followers)
      .slice(0, 50);

    const moderationQueue = [
      ...reports.map((report: any) => {
        const post = postsById.get(String(report.post_id));
        return {
          queue_type: "reported_post",
          id: report.id,
          post_id: report.post_id,
          status: report.status || "open",
          reason: report.reason || "report",
          notes: report.notes || null,
          user_email: report.user_email || null,
          post_title: post?.title || post?.species || "Community post",
          post_status: post?.status || null,
          caption: post?.caption || "",
          created_at: report.created_at,
        };
      }),
      ...comments.filter((comment) => String(comment.status || "active") !== "active").map((comment) => ({
        queue_type: "held_comment",
        id: comment.id,
        post_id: comment.post_id,
        status: comment.status,
        reason: "held_comment",
        user_email: comment.user_email || null,
        body: comment.body,
        created_at: comment.created_at,
      })),
    ].sort((a: any, b: any) => Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || "")));

    ok(reply, {
      success: true,
      admin: { id: admin.id, email: admin.email },
      support_cases: supportCases,
      moderation_queue: moderationQueue.slice(0, 150),
      safety_flags: safetyFlags.slice(0, 150),
      social_graph: socialGraph,
      recent_follows: (follows as any[]).slice(0, 80),
      message_safety: {
        status: "not_enabled",
        recommendation: "Enable direct messages only after mutual follow, report/block controls, AI moderation, and admin review of flagged conversations are live.",
        required_controls: [
          "Mutual-follow or approved-friend messaging",
          "AI scan before message delivery",
          "User block and report",
          "Admin queue for flagged/reported messages only",
          "Audit log for moderator access",
          "Rate limits and spam detection",
        ],
      },
      totals: {
        open_support_cases: supportCases.length,
        moderation_items: moderationQueue.length,
        safety_flags: safetyFlags.length,
        follows: (follows as any[]).length,
      },
      audit,
    });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function adminUpdateCommunityReportHandler(req: any, reply: any) {
  try {
    const admin = await requireAdminUser(req);
    const id = str((req.params as any)?.id);
    const status = str((req.body as any)?.status, "reviewed").toLowerCase();
    if (!["open", "reviewing", "reviewed", "closed"].includes(status)) throw adminError("Report status must be open, reviewing, reviewed, or closed.", 400);
    const patch = { status, updated_at: new Date().toISOString() };
    if (supabase) {
      const saved = await supabase.from("community_reports").update(patch).eq("id", id).select(COMMUNITY_REPORT_SELECT).maybeSingle();
      if (saved.error && (saved.error as any)?.code !== "PGRST116") throw saved.error;
      await writeAuditLog(admin, "community_report_status_updated", "community_report", id, patch);
      ok(reply, { success: true, report: saved.data ? normalizeCommunityReport(saved.data) : null });
      return;
    }
    const rows = await readLocalCommunityReports();
    const row = rows.find((item) => String(item.id) === id);
    if (row) Object.assign(row, patch);
    await writeLocalCommunityReports(rows);
    await writeAuditLog(admin, "community_report_status_updated", "community_report", id, patch);
    ok(reply, { success: true, report: row || null });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

async function adminUpdateCommunityCommentHandler(req: any, reply: any) {
  try {
    const admin = await requireAdminUser(req);
    const id = str((req.params as any)?.id);
    const status = str((req.body as any)?.status, "active").toLowerCase();
    if (!["active", "held", "hidden", "deleted"].includes(status)) throw adminError("Comment status must be active, held, hidden, or deleted.", 400);
    const patch = { status, updated_at: new Date().toISOString() };
    if (supabase) {
      const saved = await supabase.from("community_comments").update(patch).eq("id", id).select(COMMUNITY_COMMENT_SELECT).maybeSingle();
      if (saved.error && (saved.error as any)?.code !== "PGRST116") throw saved.error;
      await writeAuditLog(admin, "community_comment_status_updated", "community_comment", id, patch);
      ok(reply, { success: true, comment: saved.data ? normalizeCommunityComment(saved.data) : null });
      return;
    }
    const rows = await readLocalCommunityComments();
    const row = rows.find((item) => String(item.id) === id);
    if (row) Object.assign(row, patch);
    await writeLocalCommunityComments(rows);
    await writeAuditLog(admin, "community_comment_status_updated", "community_comment", id, patch);
    ok(reply, { success: true, comment: row || null });
  } catch (e) {
    fail(reply, e, (e as any)?.statusCode || 500);
  }
}

function activityStreak(rows: { created_at: string }[]) {
  const days = new Set(rows.map((row) => String(row.created_at || "").slice(0, 10)).filter(Boolean));
  let current = 0;
  const cursor = new Date();
  while (days.has(cursor.toISOString().slice(0, 10))) {
    current += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { current_days: current, milestones: [1, 3, 7, 30, 90, 365], next_milestone: [1, 3, 7, 30, 90, 365].find((day) => day > current) || null };
}

async function communityProfileHandler(req: any, reply: any) {
  try {
    const viewer = await getAuthUser(req);
    const userId = str(req.params?.id, viewer.id);
    const all = await listCommunityPostsForUser(viewer, "trending");
    const posts = all.posts.filter((post) => post.user_id === userId);
    const follows = supabase
      ? await supabase.from("community_follows").select("follower_id,following_id").or(`follower_id.eq.${userId},following_id.eq.${userId}`).then((res) => res.data || []).catch(() => [])
      : await readLocalCommunityFollows();
    const followers = follows.filter((row: any) => String(row.following_id) === userId).length;
    const following = follows.filter((row: any) => String(row.follower_id) === userId).length;
    const own = userId === viewer.id;
    const rewards = own ? await rewardSummaryForUser(viewer) : null;
    const catches = own ? await listUserCatches(viewer, 1000).catch(() => []) : [];
    const speciesCounts = new Map<string, number>();
    catches.forEach((row) => speciesCounts.set(row.species, (speciesCounts.get(row.species) || 0) + 1));
    const largest = catches.sort((a, b) => Number(b.weight_kg || b.length_cm || 0) - Number(a.weight_kg || a.length_cm || 0))[0] || null;
    const author = posts[0] || null;
    ok(reply, {
      success: true,
      profile: {
        user_id: userId,
        name: author?.author_name || (own ? viewer.email : "OceanCore angler"),
        avatar_url: null,
        followers,
        following,
        is_following: follows.some((row: any) => String(row.follower_id) === viewer.id && String(row.following_id) === userId),
        oceanpoints: rewards?.balance ?? null,
        community_level: rewards?.level ?? null,
        stats: {
          total_catches: catches.length,
          largest_fish: largest,
          most_caught_species: [...speciesCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
          total_posts: posts.length,
          total_videos: posts.filter((post) => post.post_type === "video" || post.media_type === "video").length,
          total_likes: posts.reduce((sum, post) => sum + Number(post.likes_count || 0), 0),
        },
      },
    });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
}

async function communityFollowHandler(req: any, reply: any) {
  try {
    const user = await getCommunityWriteUser(req);
    const followingId = str(req.params?.id, "");
    if (!followingId || followingId === user.id) throw uploadError("Choose another OceanCore member to follow.", 400);
    let following = true;
    if (supabase) {
      const existing = await supabase.from("community_follows").select("follower_id").eq("follower_id", user.id).eq("following_id", followingId).maybeSingle();
      if (existing.data) {
        await supabase.from("community_follows").delete().eq("follower_id", user.id).eq("following_id", followingId);
        following = false;
      } else {
        const saved = await supabase.from("community_follows").insert({ follower_id: user.id, following_id: followingId });
        if (saved.error) throw saved.error;
      }
    } else {
      const rows = await readLocalCommunityFollows();
      const index = rows.findIndex((row) => row.follower_id === user.id && row.following_id === followingId);
      if (index >= 0) { rows.splice(index, 1); following = false; }
      else rows.push({ follower_id: user.id, following_id: followingId, created_at: new Date().toISOString() });
      await writeLocalCommunityFollows(rows);
    }
    ok(reply, { success: true, following });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
}

async function communityPollVoteHandler(req: any, reply: any) {
  try {
    const user = await getCommunityWriteUser(req);
    const postId = str(req.params?.id, "");
    const optionId = str(req.body?.option_id, "");
    const post = await findCommunityPostById(postId);
    if (!post || post.post_type !== "poll") throw uploadError("Poll not found.", 404);
    if (!(post.poll_options || []).some((option) => option.id === optionId)) throw uploadError("Choose a valid poll option.", 400);
    if (supabase) {
      const saved = await supabase.from("community_poll_votes").upsert({ post_id: postId, option_id: optionId, user_id: user.id, created_at: new Date().toISOString() }, { onConflict: "post_id,user_id" });
      if (saved.error) throw saved.error;
      const votes = await supabase.from("community_poll_votes").select("option_id").eq("post_id", postId);
      post.poll_options = (post.poll_options || []).map((option) => ({ ...option, votes: (votes.data || []).filter((vote: any) => vote.option_id === option.id).length }));
      await supabase.from(COMMUNITY_POSTS_TABLE).update({ poll_options: post.poll_options, updated_at: new Date().toISOString() }).eq("id", postId);
    } else {
      const votes = await readLocalCommunityPollVotes();
      const existing = votes.find((vote) => vote.post_id === postId && vote.user_id === user.id);
      if (existing) existing.option_id = optionId;
      else votes.push({ post_id: postId, option_id: optionId, user_id: user.id, created_at: new Date().toISOString() });
      await writeLocalCommunityPollVotes(votes);
      post.poll_options = (post.poll_options || []).map((option) => ({ ...option, votes: votes.filter((vote) => vote.post_id === postId && vote.option_id === option.id).length }));
      const posts = await readLocalCommunityPosts();
      const index = posts.findIndex((row) => row.id === postId);
      if (index >= 0) posts[index] = normalizeCommunityPost({ ...posts[index], poll_options: post.poll_options });
      await writeLocalCommunityPosts(posts);
    }
    ok(reply, { success: true, poll_options: post.poll_options });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
}

async function communityDashboardHandler(req: any, reply: any) {
  try {
    const user = await getAuthUser(req);
    const [posts, rewards] = await Promise.all([listCommunityPostsForUser(user, "trending"), listRewardLedger(user, 5000)]);
    const byUser = new Map<string, { user_id: string; name: string; posts: number; videos: number; likes: number; comments: number; score: number }>();
    posts.posts.forEach((post) => {
      const id = String(post.user_id || "unknown");
      const row = byUser.get(id) || { user_id: id, name: post.author_name || "OceanCore angler", posts: 0, videos: 0, likes: 0, comments: 0, score: 0 };
      row.posts += 1; row.videos += post.post_type === "video" || post.media_type === "video" ? 1 : 0;
      row.likes += Number(post.likes_count || 0); row.comments += Number(post.comments_count || 0);
      row.score = row.posts * 2 + row.videos * 10 + row.likes * 3 + row.comments * 5;
      byUser.set(id, row);
    });
    ok(reply, {
      success: true,
      streak: activityStreak(rewards.rows),
      leaderboards: {
        top_creators: [...byUser.values()].sort((a, b) => b.score - a.score).slice(0, 10),
        most_helpful: [...byUser.values()].sort((a, b) => b.comments - a.comments).slice(0, 10),
        most_viewed: [],
      },
      achievements: [
        { id: "first_post", name: "First Post", unlocked: posts.posts.some((post) => post.user_id === user.id) },
        { id: "first_video", name: "First Video", unlocked: posts.posts.some((post) => post.user_id === user.id && (post.post_type === "video" || post.media_type === "video")) },
        { id: "community_10", name: "Community Regular", unlocked: posts.posts.filter((post) => post.user_id === user.id).length >= 10 },
      ],
    });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
}

app.get("/community/posts", communityPostsHandler);
app.get("/api/community/posts", communityPostsHandler);
app.post("/community/posts", createCommunityPostHandler);
app.post("/api/community/posts", createCommunityPostHandler);
app.post("/community/posts/:id/like", communityLikeHandler);
app.post("/api/community/posts/:id/like", communityLikeHandler);
app.get("/community/posts/:id/comments", communityCommentsHandler);
app.get("/api/community/posts/:id/comments", communityCommentsHandler);
app.post("/community/posts/:id/comments", createCommunityCommentHandler);
app.post("/api/community/posts/:id/comments", createCommunityCommentHandler);
app.post("/community/posts/:id/report", reportCommunityPostHandler);
app.post("/api/community/posts/:id/report", reportCommunityPostHandler);
app.delete("/community/posts/:id", deleteCommunityPostHandler);
app.delete("/api/community/posts/:id", deleteCommunityPostHandler);
app.get("/community/profile/:id", communityProfileHandler);
app.get("/api/community/profile/:id", communityProfileHandler);
app.post("/community/profile/:id/follow", communityFollowHandler);
app.post("/api/community/profile/:id/follow", communityFollowHandler);
app.post("/community/posts/:id/vote", communityPollVoteHandler);
app.post("/api/community/posts/:id/vote", communityPollVoteHandler);
app.get("/community/dashboard", communityDashboardHandler);
app.get("/api/community/dashboard", communityDashboardHandler);
app.get("/admin/community/posts", adminCommunityPostsHandler);
app.patch("/admin/community/posts/:id", adminUpdateCommunityPostHandler);
app.get("/admin/support-center", adminSupportCenterHandler);
app.patch("/admin/community/reports/:id", adminUpdateCommunityReportHandler);
app.patch("/admin/community/comments/:id", adminUpdateCommunityCommentHandler);

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
    const proUsers = (profiles as any[]).filter((p) => ["lite", "premium", "crew", "founder"].includes(normalizePlanKey(p.plan))).length;
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

    const rewards = await rewardSummaryForUser({
      id: selectedId,
      email: user?.email || profile?.email || null,
      isGuest: false,
      user_metadata: user?.user_metadata || {},
    }).catch(() => null);

    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, user, profile, catches, rewards });
  } catch (e) { fail(reply, e, (e as any)?.statusCode || 500); }
});

app.post("/admin/users/:id/rewards/adjust", async (req, reply) => {
  try {
    const admin = await requireAdminUser(req);
    const userId = str((req.params as any)?.id);
    const body = (req.body || {}) as any;
    const points = Math.trunc(Number(body.points || 0));
    const reason = str(body.reason, "").slice(0, 240);
    const email = str(body.email, "") || null;
    if (!userId) throw adminError("User id is required.", 400);
    if (!Number.isFinite(points) || points === 0 || Math.abs(points) > 100000) {
      throw adminError("Points adjustment must be between -100,000 and 100,000 and cannot be zero.", 400);
    }
    if (reason.length < 3) throw adminError("Add a short reason for the points adjustment.", 400);

    const row = normalizeRewardLedger({
      id: crypto.randomUUID(),
      user_id: userId,
      user_email: email,
      event_type: "admin_adjustment",
      event_key: `admin_adjustment:${crypto.randomUUID()}`,
      points,
      title: points > 0 ? "OceanPoints added by OceanCore support" : "OceanPoints adjusted by OceanCore support",
      source_type: "admin",
      source_id: admin.id,
      metadata: { reason, admin_email: admin.email },
      status: "earned",
      created_at: new Date().toISOString(),
    });

    if (supabase) {
      const saved = await supabase.from(REWARD_LEDGER_TABLE).insert(row).select("id").single();
      if (saved.error) throw saved.error;
    } else {
      const rows = await readLocalRewardLedger();
      rows.push(row);
      await writeLocalRewardLedger(rows);
    }
    await writeAuditLog(admin, "reward_points_adjusted", "user", userId, { points, reason });
    const rewards = await rewardSummaryForUser({ id: userId, email, isGuest: false, user_metadata: {} });
    ok(reply, { success: true, admin: { id: admin.id, email: admin.email }, adjustment: row, rewards });
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
      plan: normalizePlanKey(body.plan),
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
  if (inp.tripType === 'bar' || inp.barCrossing) f *= 1.04;
  if (inp.nightRun) f *= 1.03;
  return clamp(f, 1, 1.75);
}
function boatAiReturnBias(inp: any) {
  let b = 0.05;
  if (inp.tripType === 'offshore') b += 0.03;
  if (inp.tripType === 'remote') b += 0.06;
  if (inp.tripType === 'bar' || inp.barCrossing) b += 0.06;
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
function boatAiWindLimitValue(state: string) {
  if (state === '25+') return 28;
  if (state === '20-25') return 23;
  if (state === '10-20') return 16;
  return 8;
}
function boatAiSwellLimitValue(state: string) {
  if (state === '2.5+') return 2.8;
  if (state === '2-2.5') return 2.2;
  if (state === '1-1.8') return 1.4;
  return 0.8;
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
    baseHp: Number(raw?.baseHp ?? raw?.base_hp ?? raw?.hp ?? 150),
    engineCount: Math.max(1, Number(raw?.engineCount ?? raw?.engine_count ?? 1)),
    engineType: String(raw?.engineType || raw?.engine_type || '4-stroke'),
    tankCapacity: Number(raw?.tankCapacity ?? raw?.tank_capacity_l ?? raw?.fuel ?? raw?.fuel_onboard_l ?? 150),
    usableFuelPct: clamp(Number(raw?.usableFuelPct ?? raw?.usable_fuel_pct ?? 95), 50, 100),
    burnCalibration: clamp(Number(raw?.burnCalibration ?? raw?.burn_calibration_percent ?? 100), 65, 145),
    fuelPrice: Math.max(0, Number(raw?.fuelPrice ?? raw?.fuel_price ?? 0)),
    crew: Math.max(0, Number(raw?.crew ?? 0)),
    payload: Math.max(0, Number(raw?.payload ?? raw?.payload_kg ?? 0)),
    skipperLevel: String(raw?.skipperLevel || raw?.skipper_level || 'intermediate'),
    safetyGear: String(raw?.safetyGear || raw?.safety_gear || 'full'),
    maxWindKn: Math.max(0, Number(raw?.maxWindKn ?? raw?.max_wind_kn ?? 20)),
    maxSwellM: Math.max(0, Number(raw?.maxSwellM ?? raw?.max_swell_m ?? 1.8)),
    barCrossing: raw?.barCrossing === true || raw?.bar_crossing === true || raw?.barCrossing === 'yes' || raw?.bar_crossing === 'yes',
    nightRun: raw?.nightRun === true || raw?.night_run === true || raw?.nightRun === 'yes' || raw?.night_run === 'yes',
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
  const planningWeight = inp.weight + (inp.crew * 85) + inp.payload;
  const ws = boatAiWeightSanity(inp.loa, planningWeight);
  const wot = inp.hp * boatAiWotPerHp(inp.engineType);
  let flat = inp.hp * boatAiCruiseCoeff(inp.engineType) * Math.pow(Math.max(3, inp.speed) / 22, 1.85);
  if (inp.speed >= 9 && inp.speed < 18) flat *= 1 + (18 - inp.speed) * 0.055;
  if (inp.speed < 9) flat *= 0.42 + (inp.speed / 9) * 0.58;
  const expectedKg = Math.max(650, inp.loa * 230);
  flat *= boatAiHullFactor(inp.hullType) * clamp(Math.pow(ws.kg / expectedKg, 0.28), 0.88, 1.18) * clamp(1 + ((inp.loa - 5.8) * 0.018), 0.94, 1.08);
  flat = clamp(flat, wot * 0.16, wot * 0.76);
  flat *= clamp(inp.burnCalibration / 100, 0.65, 1.45);
  const cond = boatAiConditionFactor(inp);
  const base = flat * cond;
  const rb = boatAiReturnBias(inp);
  const outFuel = ((total / 2) / speedKmh) * base;
  const homeFuel = ((total / 2) / speedKmh) * base * (1 + rb);
  const tripFuel = outFuel + homeFuel;
  const hours = total / speedKmh;
  const avg = hours ? tripFuel / hours : 0;
  const usableFuel = Math.min(Math.max(0, inp.fuel), Math.max(0, inp.tankCapacity || inp.fuel)) * inp.usableFuelPct / 100;
  const reserveL = usableFuel * (inp.reserve / 100);
  const spare = usableFuel - tripFuel - reserveL;
  const usable = Math.max(0, usableFuel - reserveL);
  const range = avg ? usable / avg * speedKmh : 0;
  const loadPct = wot ? avg / wot : 0;
  const fuelCost = tripFuel * inp.fuelPrice;
  const windMax = boatAiWindLimitValue(inp.wind);
  const swellMax = boatAiSwellLimitValue(inp.swell);
  const windOverLimit = inp.maxWindKn > 0 && windMax > inp.maxWindKn;
  const swellOverLimit = inp.maxSwellM > 0 && swellMax > inp.maxSwellM;
  let risk = 0;
  if (inp.wind !== '0-10') risk++;
  if (inp.swell !== 'below-1') risk++;
  if (inp.windAngle === 'unknown' || inp.windAngle === 'against') risk++;
  if (inp.tripType === 'bar' || inp.tripType === 'remote' || inp.tripType === 'offshore') risk++;
  if (inp.barCrossing) risk++;
  if (inp.nightRun) risk++;
  if (inp.safetyGear === 'partial') risk++;
  if (inp.safetyGear === 'minimal') risk += 2;
  if (inp.skipperLevel === 'learner') risk++;
  const sparePct = usableFuel ? (spare / usableFuel) * 100 : 0;
  let decision = 'GO', reason = 'Fuel buffer looks healthy for this plan.';
  if (spare < 0 || range < total || inp.wind === '25+' || inp.swell === '2.5+' || windOverLimit || swellOverLimit || inp.safetyGear === 'minimal') {
    decision = 'NO GO';
    if (spare < 0) reason = `Short by ${Math.abs(spare).toFixed(0)}L after reserve.`;
    else if (windOverLimit || swellOverLimit) reason = 'Conditions exceed your Boat AI safety settings.';
    else if (inp.safetyGear === 'minimal') reason = 'Safety gear is marked minimal. Fix that before relying on this trip plan.';
    else reason = 'Conditions/range fail.';
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
  if (loadPct > 0.62) confidence -= 8;
  if (inp.skipperLevel === 'learner') confidence -= 5;
  if (inp.safetyGear === 'partial') confidence -= 8;
  if (inp.nightRun) confidence -= 6;
  confidence = clamp(confidence, 45, 96);
  return { success: true, input: inp, planning_weight_kg: round2(planningWeight), weight_sanity: ws, flat_burn_lph: round2(flat), condition_factor: round2(cond), average_burn_lph: round2(avg), trip_fuel_l: round2(tripFuel), reserve_l: round2(reserveL), spare_l: round2(spare), spare_percent: round2(sparePct), safe_range_km: round2(range), usable_fuel_l: round2(usableFuel), out_fuel_l: round2(outFuel), return_fuel_l: round2(homeFuel), return_bias_percent: Math.round(rb * 100), fuel_cost: round2(fuelCost), wind_over_limit: windOverLimit, swell_over_limit: swellOverLimit, decision, reason, confidence: Math.round(confidence), wot_lph: round2(wot), load_percent: round2(loadPct * 100) };
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
      "/app/",
      "/legal",
      "/legal/docs",
      "/legal/terms-of-service",
      "/legal/privacy-policy",
      "/legal/account-deletion",
      "/legal/marine-disclaimer",
      "/auth/login",
      "/auth/signup",
      "/auth/refresh",
      "/auth/logout",
      "/auth/me",
      "/auth/reset-password",
      "/auth/magic-link",
      "/auth/update-password",
      "/auth/profile",
      "/auth/settings",
      "/auth/avatar",
      "/auth/email",
      "/auth/export-data",
      "/auth/account",
      "/auth/legal-status",
      "/auth/accept-legal",
      "/catches",
      "/catches/photo",
      "/catches/with-photo",
      "/api/stats",
      "/api/geocode/search",
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
      "/admin/users/:id/rewards/adjust",
      "/admin/users/:id/suspend",
      "/admin/users/:id/unsuspend",
      "/feedback",
      "/admin/feedback",
      "/admin/audit",
      "/admin/support-center",
      "/saved-areas",
      "/community/posts",
      "/community/media/upload-ticket",
      "/api/community/posts",
      "/community/posts/:id/like",
      "/api/community/posts/:id/like",
      "/community/posts/:id/comments",
      "/api/community/posts/:id/comments",
      "/community/posts/:id/report",
      "/api/community/posts/:id/report",
      "/community/posts/:id",
      "/api/community/posts/:id",
      "/admin/community/posts",
      "/admin/community/posts/:id",
      "/admin/community/reports/:id",
      "/admin/community/comments/:id",
      "/rewards/catalog",
      "/rewards/me",
      "/rewards/reconcile",
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
