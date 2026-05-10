const API_URL = (process.env.API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const EMAIL = process.env.REVIEWER_EMAIL || process.env.SMOKE_EMAIL || "";
const PASSWORD = process.env.REVIEWER_PASSWORD || process.env.SMOKE_PASSWORD || "";
const CREATE_IF_MISSING = process.env.REVIEWER_CREATE === "true";

function fail(message) {
  throw new Error(message);
}

function reviewerValue(name, fallback) {
  return String(process.env[name] || fallback || "").trim();
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, options);
  const json = await readJson(res);
  if (!res.ok) {
    const message = json.error || json.message || `HTTP ${res.status}`;
    fail(`${path}: ${message}`);
  }
  return json;
}

async function login() {
  try {
    return await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
  } catch (error) {
    if (!CREATE_IF_MISSING) throw error;
  }

  const signup = await request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (signup.email_confirmation_required) {
    fail("reviewer account was created but needs email confirmation before it can be prepared");
  }
  if (signup?.session?.access_token) return signup;
  return request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
}

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    fail("set REVIEWER_EMAIL and REVIEWER_PASSWORD, or SMOKE_EMAIL and SMOKE_PASSWORD");
  }

  const legalDocs = await request("/legal/docs");
  const loginResult = await login();
  const token = loginResult?.session?.access_token;
  if (!token) fail("reviewer login did not return an access token");

  const headers = authHeaders(token);
  const profileResult = await request("/auth/profile", { headers });
  const currentProfile = profileResult?.profile || {};
  const profile = {
    full_name: reviewerValue("REVIEWER_FULL_NAME", currentProfile.full_name || "OceanCore App Review"),
    username: reviewerValue("REVIEWER_USERNAME", currentProfile.username || "app-review"),
    boat_name: reviewerValue("REVIEWER_BOAT_NAME", currentProfile.boat_name || "Review Boat"),
    home_port: reviewerValue("REVIEWER_HOME_PORT", currentProfile.home_port || "Moreton Bay"),
    favourite_species: reviewerValue("REVIEWER_FAVOURITE_SPECIES", currentProfile.favourite_species || "Snapper"),
    role_plan: reviewerValue("REVIEWER_ROLE_PLAN", currentProfile.role_plan || "Reviewer account"),
    avatar_url: reviewerValue("REVIEWER_AVATAR_URL", currentProfile.avatar_url || ""),
  };

  await request("/auth/profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify(profile),
  });

  await request("/auth/accept-legal", {
    method: "POST",
    headers,
    body: JSON.stringify({
      version: legalDocs.version || "",
      terms: true,
      privacy: true,
      disclaimer: true,
      accepted_at: new Date().toISOString(),
    }),
  });

  await request("/auth/settings", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      settings: {
        map: { defaultView: "windy", defaultOverlay: "wind", defaultRadiusKm: 35 },
        ai: { answerStyle: "practical", useMarineConditions: true, saveChatHistory: true },
        privacy: { defaultCatchPrivacy: "general", hideExactGpsInAi: true, stripPhotoMetadata: true },
        community: { defaultPostPrivacy: "area_only", defaultTab: "feed", allowCommentsByDefault: true },
        notifications: { tripAlerts: true, savedAreaAlerts: true, communityReplies: true, boatService: true },
      },
    }),
  });

  const me = await request("/auth/me", { headers });
  const legal = await request("/auth/legal-status", { headers });
  const settings = await request("/auth/settings", { headers });
  const billing = await request("/billing/me", { headers });
  const exported = await request("/auth/export-data", { headers });

  if (!me?.user?.email) fail("prepared reviewer account did not return a user email");
  if (legal?.accepted !== true) fail("legal acceptance did not stick for reviewer account");
  if (!settings?.settings) fail("reviewer settings did not round-trip");
  if (!billing?.profile) fail("reviewer billing profile did not load");
  if (!exported?.user?.email) fail("reviewer export did not return account data");

  console.log("Reviewer account prepared.");
  console.log(`API: ${API_URL}`);
  console.log(`Email: ${me.user.email}`);
  console.log(`Legal version: ${legal.version || legalDocs.version || "current"}`);
  console.log(`Settings storage: ${settings.storage || "unknown"}`);
  console.log(`Plan: ${billing.profile?.plan || "unknown"}`);
}

await main().catch((error) => {
  console.error(`fail - reviewer account prep: ${error.message}`);
  process.exitCode = 1;
});
