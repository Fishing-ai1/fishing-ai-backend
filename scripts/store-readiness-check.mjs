import fs from "node:fs/promises";
import path from "node:path";

const API_URL = (process.env.API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const FRONTEND_URL = (process.env.FRONTEND_URL || API_URL).replace(/\/+$/, "");
const FRONTEND_APP_PATH = process.env.FRONTEND_APP_PATH ?? (FRONTEND_URL === API_URL ? "/app" : "");
const STRICT_STORE_CHECK = process.env.STRICT_STORE_CHECK === "true";
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL || process.env.SMOKE_EMAIL || "";
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD || process.env.SMOKE_PASSWORD || "";
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const requiredFiles = [
  "fishing-ai-frontend/index.html",
  "fishing-ai-frontend/manifest.webmanifest",
  "fishing-ai-frontend/sw.js",
  "fishing-ai-frontend/offline.html",
  "fishing-ai-frontend/assets/native-config.js",
  "fishing-ai-frontend/assets/icons/icon-192.png",
  "fishing-ai-frontend/assets/icons/icon-512.png",
  "fishing-ai-frontend/assets/icons/maskable-512.png",
  "fishing-ai-frontend/assets/icons/apple-touch-icon.png",
  "fishing-ai-frontend/assets/icons/store-icon-1024.png",
  "mobile-wrapper/package.json",
  "mobile-wrapper/capacitor.config.ts",
  "mobile-wrapper/android/app/src/main/AndroidManifest.xml",
  "mobile-wrapper/ios/App/App/Info.plist",
  "mobile-wrapper/ios/App/App/PrivacyInfo.xcprivacy",
  "mobile-wrapper/store-metadata/app-privacy.json",
  "mobile-wrapper/store-metadata/play-data-safety.md",
  "mobile-wrapper/store-metadata/review-notes.md",
  "APP_STORE_READINESS.md",
];

const requiredFrontendUrls = [
  `${FRONTEND_APP_PATH}/`,
  `${FRONTEND_APP_PATH}/manifest.webmanifest`,
  `${FRONTEND_APP_PATH}/sw.js`,
  `${FRONTEND_APP_PATH}/offline.html`,
  `${FRONTEND_APP_PATH}/assets/native-config.js`,
  `${FRONTEND_APP_PATH}/assets/icons/icon-512.png`,
];

const requiredBackendUrls = [
  "/legal/privacy-policy",
  "/legal/terms-of-service",
  "/legal/account-deletion",
  "/legal/marine-disclaimer",
];

const storeMetadataFiles = [
  "mobile-wrapper/store-metadata/app-privacy.json",
  "mobile-wrapper/store-metadata/play-data-safety.md",
  "mobile-wrapper/store-metadata/review-notes.md",
];

const storePlaceholderTokens = [
  "YOUR-PRODUCTION-BACKEND",
  "your-production-backend",
  "your-production-backend.example.com",
];

function ok(message) {
  console.log(`ok - ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function request(urlPath, options = {}) {
  const res = await fetch(`${API_URL}${urlPath}`, options);
  const json = await readJson(res);
  if (!res.ok) {
    const message = json.error || json.message || `HTTP ${res.status}`;
    fail(`${urlPath}: ${message}`);
  }
  return json;
}

async function readText(file) {
  return fs.readFile(path.join(repoRoot, file), "utf8");
}

async function exists(file) {
  try {
    await fs.access(path.join(repoRoot, file));
    return true;
  } catch {
    return false;
  }
}

async function checkFiles() {
  for (const file of requiredFiles) {
    if (!(await exists(file))) fail(`missing file: ${file}`);
  }
  ok("required files exist");
}

async function checkManifest() {
  const manifest = JSON.parse(await readText("fishing-ai-frontend/manifest.webmanifest"));
  if (manifest.name !== "OceanCore AI") fail("manifest name is wrong");
  if (manifest.start_url !== "/app/") fail("manifest start_url must be /app/");
  if (manifest.display !== "standalone") fail("manifest display must be standalone");
  const hasMaskable = (manifest.icons || []).some((icon) => String(icon.purpose || "").includes("maskable"));
  if (!hasMaskable) fail("manifest missing maskable icon");
  ok("manifest ready");
}

async function checkPackageScripts() {
  const pkg = JSON.parse(await readText("fishing-ai-backend/package.json"));
  for (const script of ["smoke", "audit:full", "store:check", "store:metadata", "reviewer:prepare", "launch:preflight"]) {
    if (!pkg.scripts?.[script]) fail(`package.json missing ${script} script`);
  }
  ok("launch scripts ready");
}

async function checkServiceWorker() {
  const sw = await readText("fishing-ai-frontend/sw.js");
  for (const token of ["/app/offline.html", "/app/assets/native-config.js", "/auth/", "/api/", "/billing/", "/community/"]) {
    if (!sw.includes(token)) fail(`service worker missing ${token}`);
  }
  ok("service worker cache rules ready");
}

async function checkSupabaseSchema() {
  const schema = await readText("fishing-ai-backend/supabase/schema.sql");
  for (const token of [
    "author_name text",
    "media_mime text",
    "allow_comments boolean",
    "comment_permission text",
    "hold_link_comments boolean",
    "blocked_words text",
    "upload_quality text",
    "catches add column if not exists general_area",
    "catches add column if not exists privacy",
    "community_likes add column if not exists user_email",
    "community_reports add column if not exists notes",
  ]) {
    if (!schema.includes(token)) fail(`Supabase schema missing app column: ${token}`);
  }
  ok("Supabase app schema ready");
}

async function checkNative() {
  const androidManifest = await readText("mobile-wrapper/android/app/src/main/AndroidManifest.xml");
  for (const token of [
    'android:allowBackup="false"',
    'android:usesCleartextTraffic="false"',
    "android.permission.CAMERA",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.READ_MEDIA_IMAGES",
  ]) {
    if (!androidManifest.includes(token)) fail(`Android manifest missing ${token}`);
  }

  const iosPlist = await readText("mobile-wrapper/ios/App/App/Info.plist");
  for (const token of [
    "NSCameraUsageDescription",
    "NSLocationWhenInUseUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSMicrophoneUsageDescription",
    "ITSAppUsesNonExemptEncryption",
  ]) {
    if (!iosPlist.includes(token)) fail(`iOS Info.plist missing ${token}`);
  }

  const privacyManifest = await readText("mobile-wrapper/ios/App/App/PrivacyInfo.xcprivacy");
  for (const token of [
    "NSPrivacyTracking",
    "NSPrivacyCollectedDataTypes",
    "NSPrivacyCollectedDataTypeEmailAddress",
    "NSPrivacyCollectedDataTypePreciseLocation",
    "NSPrivacyCollectedDataTypePhotosorVideos",
    "NSPrivacyAccessedAPICategoryUserDefaults",
  ]) {
    if (!privacyManifest.includes(token)) fail(`iOS PrivacyInfo.xcprivacy missing ${token}`);
  }

  const xcodeProject = await readText("mobile-wrapper/ios/App/App.xcodeproj/project.pbxproj");
  if (!xcodeProject.includes("PrivacyInfo.xcprivacy in Resources")) {
    fail("iOS project is not bundling PrivacyInfo.xcprivacy");
  }

  const appPrivacy = JSON.parse(await readText("mobile-wrapper/store-metadata/app-privacy.json"));
  if (appPrivacy.tracking !== false) fail("app privacy metadata must declare tracking false");
  if (!appPrivacy.dataLinkedToUser?.some((entry) => entry.types?.includes("Photos or Videos"))) {
    fail("app privacy metadata missing photos/videos disclosure");
  }

  ok("native permission config ready");
}

async function checkUrls() {
  for (const urlPath of requiredFrontendUrls) {
    const res = await fetch(`${FRONTEND_URL}${urlPath}`, { headers: { Accept: "text/html,application/json,*/*" } });
    if (!res.ok) fail(`${urlPath}: frontend returned HTTP ${res.status}`);
  }
  for (const urlPath of requiredBackendUrls) {
    const res = await fetch(`${API_URL}${urlPath}`, { headers: { Accept: "text/html,application/json,*/*" } });
    if (!res.ok) fail(`${urlPath} returned HTTP ${res.status}`);
    const text = await res.text();
    if (urlPath.startsWith("/legal/") && !text.includes("OceanCore AI")) fail(`${urlPath} missing OceanCore text`);
  }
  ok(`required frontend URLs serve from ${FRONTEND_URL}`);
  ok(`required backend URLs serve from ${API_URL}`);
}

async function checkBackendSecurity() {
  const healthRes = await fetch(`${API_URL}/health`);
  if (!healthRes.ok) fail(`/health returned HTTP ${healthRes.status}`);
  const health = await healthRes.json();
  if (!health.security_headers_enabled) fail("security headers are disabled");
  if (!health.rate_limits_enabled) fail("rate limits are disabled");
  if (!Array.isArray(health.native_app_origins) || !health.native_app_origins.includes("https://localhost")) {
    fail("native app origins are not configured for Capacitor");
  }
  if (!health.upload_limits?.catch_photo_max_bytes || !health.upload_limits?.community_media_max_bytes) {
    fail("upload limits are missing from health");
  }
  if (!health.upload_limits?.image_mime_types?.includes("image/jpeg")) {
    fail("image upload MIME allowlist is missing image/jpeg");
  }
  if (!health.upload_limits?.community_media_mime_types?.includes("video/mp4")) {
    fail("community media MIME allowlist is missing video/mp4");
  }
  if (health.upload_limits?.strip_image_metadata !== true) {
    fail("image metadata stripping is not enabled");
  }
  if (!health.upload_limits?.metadata_stripped_image_mime_types?.includes("image/jpeg")) {
    fail("image metadata stripping MIME list is missing image/jpeg");
  }
  if (health.geocode_search_configured !== true) {
    fail("geocode search is not configured");
  }

  const legalRes = await fetch(`${API_URL}/legal/privacy-policy`, { headers: { Accept: "text/html" } });
  const expectedHeaders = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [name, expected] of Object.entries(expectedHeaders)) {
    const actual = legalRes.headers.get(name);
    if (actual !== expected) fail(`security header ${name} expected ${expected}, got ${actual}`);
  }
  if (!legalRes.headers.get("permissions-policy")?.includes("geolocation")) fail("permissions-policy header missing geolocation");
  ok("backend security headers and native CORS config ready");
}

function productionOrigin() {
  let parsed;
  try {
    parsed = new URL(API_URL);
  } catch {
    fail(`API_URL is not a valid URL: ${API_URL}`);
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  if (parsed.protocol !== "https:") fail("strict store check requires API_URL to use https");
  if (localHosts.has(parsed.hostname)) fail("strict store check requires a deployed production API_URL, not localhost");
  return parsed.origin.replace(/\/+$/, "");
}

async function checkStrictLaunchGate() {
  if (!STRICT_STORE_CHECK) {
    console.log("skip - strict store launch gate (set STRICT_STORE_CHECK=true with production API_URL and reviewer credentials)");
    return;
  }

  const origin = productionOrigin();
  if (!REVIEWER_EMAIL || !REVIEWER_PASSWORD) {
    fail("strict store check requires REVIEWER_EMAIL and REVIEWER_PASSWORD, or SMOKE_EMAIL and SMOKE_PASSWORD");
  }

  for (const file of storeMetadataFiles) {
    const text = await readText(file);
    for (const token of storePlaceholderTokens) {
      if (text.includes(token)) fail(`${file} still contains placeholder ${token}`);
    }
  }

  const appPrivacy = JSON.parse(await readText("mobile-wrapper/store-metadata/app-privacy.json"));
  const expectedLegalUrls = {
    privacyPolicyUrl: `${origin}/legal/privacy-policy`,
    accountDeletionUrl: `${origin}/legal/account-deletion`,
    termsUrl: `${origin}/legal/terms-of-service`,
  };
  for (const [field, expected] of Object.entries(expectedLegalUrls)) {
    if (appPrivacy[field] !== expected) fail(`app privacy ${field} must be ${expected}`);
  }

  const reviewNotes = await readText("mobile-wrapper/store-metadata/review-notes.md");
  if (!reviewNotes.includes("## Reviewer Account")) {
    fail("review notes must include a Reviewer Account section for App Review / Play review");
  }

  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: REVIEWER_EMAIL, password: REVIEWER_PASSWORD }),
  });
  const token = login?.session?.access_token;
  if (!token) fail("reviewer account login did not return an access token");

  const authHeaders = { Authorization: `Bearer ${token}` };
  const me = await request("/auth/me", { headers: authHeaders });
  if (!me?.user?.email) fail("reviewer account /auth/me did not return a user email");

  const legal = await request("/auth/legal-status", { headers: authHeaders });
  if (legal?.accepted !== true) {
    fail("reviewer account must accept Terms, Privacy, and Marine Disclaimer before store submission");
  }

  await request("/auth/settings", { headers: authHeaders });
  await request("/billing/me", { headers: authHeaders });
  const exported = await request("/auth/export-data", { headers: authHeaders });
  if (!exported?.user?.email) fail("reviewer account export data endpoint did not return account data");

  ok("strict store launch gate ready");
}

async function main() {
  await checkFiles();
  await checkManifest();
  await checkPackageScripts();
  await checkServiceWorker();
  await checkSupabaseSchema();
  await checkNative();
  await checkUrls();
  await checkBackendSecurity();
  await checkStrictLaunchGate();

  console.log("Store readiness preflight passed.");
}

await main().catch((error) => {
  console.error(`fail - store readiness: ${error.message}`);
  process.exitCode = 1;
});
