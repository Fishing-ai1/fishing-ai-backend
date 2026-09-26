import fs from "node:fs/promises";
import path from "node:path";
import { fork } from "node:child_process";
import os from "node:os";
import { pathToFileURL } from "node:url";

const backendRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");


function ok(message) {
  console.log(`ok - ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function check(name, fn) {
  try {
    const result = await fn();
    ok(name);
    return result;
  } catch (error) {
    console.error(`fail - ${name}: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
}

async function readText(file) {
  return fs.readFile(path.join(repoRoot, file), "utf8");
}

async function readJsonResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function request(baseUrl, route, options = {}) {
  const res = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(30000), ...options });
  const json = await readJsonResponse(res);
  if (!res.ok) {
    const message = json.error || json.message || `HTTP ${res.status}`;
    const error = new Error(`${route}: ${message}`);
    error.status = res.status;
    error.body = json;
    throw error;
  }
  return json;
}

function normalizeRoute(route) {
  return String(route || "")
    .replace(/\$\{[^}]+\}/g, ":id")
    .replace(/\?.*/, "")
    .replace(/\/+$/, "") || "/";
}

function routeMatches(pattern, route) {
  const re = new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}$`);
  return re.test(route);
}

async function checkFrontendIntegrity() {
  const html = await readText("fishing-ai-frontend/index.html");
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const script of scripts) new Function(script);

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]).filter((id) => !id.includes("${"));
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) fail(`duplicate DOM ids: ${duplicateIds.join(", ")}`);

  const sections = new Set([...html.matchAll(/id=["']section-([^"']+)["']/g)].map((m) => m[1]));
  const navSections = [...new Set([...html.matchAll(/data-section=["']([^"']+)["']/g)].map((m) => m[1]).filter((section) => !section.includes("${")))];
  const missingSections = navSections.filter((section) => !sections.has(section));
  if (missingSections.length) fail(`navigation targets missing sections: ${missingSections.join(", ")}`);

  for (const token of [
    "Who can comment",
    "Hold comments with links",
    "Blocked words",
    "Hide reported posts locally",
    "comment_permission",
    "hold_link_comments",
    "blocked_words",
    "notificationDigest",
    "renderNotificationCenter",
    "statsWindowDays",
    "billing.showUsageWarnings",
    "billing.upgradeReminders",
    "mapSearch",
    "btnSearchLocation",
    "/api/geocode/search",
    "data-legal-url",
    "btnOpenAccountDeletionPage",
    "/legal/account-deletion",
    "section-rewards",
    "loadRewards",
    "/rewards/reconcile",
  ]) {
    if (!html.includes(token)) fail(`frontend missing audit token: ${token}`);
  }

  return { scripts: scripts.length, ids: ids.length, navSections: navSections.length };
}

async function checkRouteIntegrity() {
  const html = await readText("fishing-ai-frontend/index.html");
  const server = await readText("fishing-ai-backend/server.ts");
  const backendRoutes = new Set(
    [...server.matchAll(/app\.(get|post|patch|delete)\(["'`]([^"'`]+)["'`]/g)].map((m) => normalizeRoute(m[2]))
  );
  const refs = new Set();

  for (const m of html.matchAll(/api(?:First)?\(([^)]*)\)/g)) {
    const call = m[1];
    for (const s of call.matchAll(/["'`]([^"'`]*\/[A-Za-z0-9_?&=./:${}-]+)["'`]/g)) {
      refs.add(normalizeRoute(s[1]));
    }
  }
  for (const m of html.matchAll(/data-legal-url=["']([^"']+)["']/g)) {
    refs.add(normalizeRoute(m[1]));
  }

  const missing = [...refs].filter((route) => {
    if (route.startsWith("http")) return false;
    if (backendRoutes.has(route)) return false;
    return ![...backendRoutes].some((pattern) => routeMatches(pattern, route));
  });

  if (missing.length) fail(`frontend references missing backend routes: ${missing.join(", ")}`);
  return { frontendRouteRefs: refs.size, backendRoutes: backendRoutes.size };
}

async function checkSchemaIntegrity() {
  const schema = await readText("fishing-ai-backend/supabase/schema.sql");
  for (const token of [
    "author_name text",
    "media_mime text",
    "allow_comments boolean",
    "comment_permission text",
    "hold_link_comments boolean",
    "blocked_words text",
    "upload_quality text",
    "privacy text not null default 'private'",
    "catches add column if not exists general_area",
    "catches add column if not exists privacy",
    "community_likes add column if not exists user_email",
    "community_reports add column if not exists notes",
    "create table if not exists public.reward_ledger",
    "unique(user_id, event_key)",
    "reward ledger own reads",
  ]) {
    if (!schema.includes(token)) fail(`schema missing ${token}`);
  }
}

async function checkBoatMath(baseUrl) {
  const input = {
    boatName: "Audit Boat",
    hullType: "fibreglass",
    loa: 5.9,
    weight: 1300,
    fuel: 150,
    tankCapacity: 150,
    hp: 150,
    engineCount: 1,
    engineType: "2-stroke DFI",
    usableFuelPct: 95,
    burnCalibration: 100,
    fuelPrice: 2.25,
    crew: 2,
    payload: 0,
    skipperLevel: "intermediate",
    safetyGear: "full",
    maxWindKn: 20,
    maxSwellM: 1.8,
    speed: 22,
    distance: 80,
    extra: 25,
    reserve: 30,
    wind: "0-10",
    swell: "below-1",
    windAngle: "unknown",
    tripType: "offshore",
  };

  const result = await request(baseUrl, "/api/boat/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const tripFromLegs = Number(result.out_fuel_l) + Number(result.return_fuel_l);
  if (Math.abs(tripFromLegs - Number(result.trip_fuel_l)) > 0.03) {
    fail(`boat trip fuel mismatch: legs ${tripFromLegs}, trip ${result.trip_fuel_l}`);
  }

  const spare = Number(result.usable_fuel_l) - Number(result.trip_fuel_l) - Number(result.reserve_l);
  if (Math.abs(spare - Number(result.spare_l)) > 0.03) {
    fail(`boat spare fuel mismatch: expected ${spare}, got ${result.spare_l}`);
  }

  if (!["GO", "GO — WATCH", "CAUTION", "NO GO"].includes(result.decision)) {
    fail(`unexpected Boat AI decision: ${result.decision}`);
  }

  return result;
}

async function runTemporaryMemoryBackend(fn) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oceancore-audit-"));
  const child = fork(path.join(backendRoot, "scripts", "audit-memory-server.ts"), [], {
    cwd: tempRoot,
    execArgv: ["--import", pathToFileURL(path.join(backendRoot, "node_modules", "tsx", "dist", "loader.mjs")).href],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "test",
      OCEANCORE_TEST_MODE: "true",
      OCEANCORE_PLATFORM_ENABLED: "false",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
  const exited = new Promise(resolve => child.once("close", resolve));
  try {
    const baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Audit backend startup timed out: " + stderr)), 15000);
      child.once("message", message => {
        clearTimeout(timer);
        if (message?.url) resolve(message.url);
        else reject(new Error("Invalid audit backend startup response"));
      });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error("Audit backend exited: " + code + " " + stderr)); });
    });
    return await fn(baseUrl);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    // Only remove the unique directory created by this audit, never project data.
    const relative = path.relative(os.tmpdir(), tempRoot);
    if (!relative.startsWith("oceancore-audit-") || relative.includes(path.sep)) throw new Error("Unexpected audit temp path");
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function checkCatchPrivacy(baseUrl) {
  const created = await request(baseUrl, "/catches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      species: "Audit Snapper",
      length_cm: 42,
      legal_limit_cm: 35,
      lat: -27.5426,
      lng: 153.0908,
      general_area: "Audit General Area",
      privacy: "general",
      notes: "Created by full audit.",
    }),
  });

  const catchId = created?.catch?.id;
  if (!catchId) fail("catch create did not return an id");
  if (created.catch.is_legal !== true) fail("catch legal-size maths failed");
  if (created.catch.general_area !== "Audit General Area") fail("catch general area did not round-trip");
  if (created.catch.privacy !== "general") fail("catch privacy did not round-trip");

  const list = await request(baseUrl, "/catches?limit=20");
  const listed = Array.isArray(list.catches) ? list.catches.find((row) => row.id === catchId) : null;
  if (!listed) fail("created catch did not appear in catch list");
  if (listed.general_area !== "Audit General Area" || listed.privacy !== "general") {
    fail("listed catch lost privacy/general-area fields");
  }

  await request(baseUrl, `/catches/${catchId}`, { method: "DELETE" });
  const after = await request(baseUrl, "/catches?limit=20");
  if ((after.catches || []).some((row) => row.id === catchId)) fail("deleted catch still appears in list");
}

async function checkCommunityModeration(baseUrl) {
  const created = await request(baseUrl, "/api/community/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      species: "Snapper",
      general_area: "Moreton Bay",
      caption: "Clean audit report.",
      privacy: "public",
      comment_permission: "everyone",
      hold_link_comments: true,
      blocked_words: "scam, abuse",
      upload_quality: "standard",
    }),
  });

  const postId = created?.post?.id;
  if (!postId) fail("community post did not return an id");
  if (created.post.comment_permission !== "everyone") fail("comment permission did not round-trip");
  if (created.post.upload_quality !== "standard") fail("upload quality did not round-trip");

  const held = await request(baseUrl, `/api/community/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Check this http://spam.example" }),
  });
  if (!held.held_for_review) fail("link comment was not held for review");

  const clean = await request(baseUrl, `/api/community/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Nice report, thanks." }),
  });
  if (clean.held_for_review) fail("clean comment was held unexpectedly");

  const comments = await request(baseUrl, `/api/community/posts/${postId}/comments`);
  if (!Array.isArray(comments.comments) || comments.comments.length !== 1) {
    fail(`expected one public active comment, got ${comments.comments?.length ?? "none"}`);
  }

  const closed = await request(baseUrl, "/api/community/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      species: "Ramp note",
      general_area: "Moreton Bay",
      caption: "Comments closed audit post.",
      privacy: "public",
      comment_permission: "off",
      allow_comments: false,
    }),
  });

  const closedPostId = closed?.post?.id;
  if (closed?.post?.allow_comments !== false) fail("comments-off setting did not round-trip");

  const denied = await fetch(`${baseUrl}/api/community/posts/${closedPostId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Should be blocked." }),
  });
  if (denied.status !== 403) {
    const body = await readJsonResponse(denied);
    fail(`comments-off post accepted a comment: HTTP ${denied.status} ${JSON.stringify(body)}`);
  }
}

async function checkCommunityTwoFoundation(baseUrl) {
  const exact = await fetch(`${baseUrl}/api/community/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      species: "Secret mark",
      general_area: "-27.12345, 153.12345",
      caption: "Should not publish exact coordinates.",
      privacy: "public",
    }),
  });
  if (exact.status < 400) fail("community accepted an exact GPS mark as a public general area");

  const video = await request(baseUrl, "/api/community/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_type: "video",
      category: "offshore",
      species: "Tuna",
      general_area: "Offshore grounds",
      caption: "Short form offshore clip.",
      privacy: "public",
      media_url: "https://example.com/oceancore-audit.mp4",
      media_mime: "video/mp4",
      media_type: "video",
    }),
  });
  if (video.post?.post_type !== "video") fail("video post type did not round-trip");
  if (video.post?.category !== "offshore") fail("community category did not round-trip");

  const videos = await request(baseUrl, "/api/community/posts?filter=videos");
  if (!(videos.posts || []).some((post) => post.id === video.post.id)) fail("video feed did not include video post");

  const poll = await request(baseUrl, "/api/community/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_type: "poll",
      species: "Crew poll",
      general_area: "Moreton Bay",
      caption: "Best bite window?",
      privacy: "public",
      poll_options: ["Dawn", "Run out tide", "Sunset"],
    }),
  });
  const optionId = poll.post?.poll_options?.[0]?.id;
  if (!optionId) fail("poll post did not create poll options");
  const vote = await request(baseUrl, `/api/community/posts/${poll.post.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ option_id: optionId }),
  });
  if (vote.poll_options?.[0]?.votes !== 1) fail("poll vote was not counted");

  const profile = await request(baseUrl, `/api/community/profile/${video.post.user_id}`);
  if (!profile.profile || profile.profile.stats.total_posts < 1) fail("community profile did not include post stats");

  const follow = await request(baseUrl, `/api/community/profile/${video.post.user_id}-other/follow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (follow.success !== true) fail("community follow endpoint failed");

  const dashboard = await request(baseUrl, "/api/community/dashboard");
  if (!dashboard.streak || !dashboard.leaderboards || !Array.isArray(dashboard.achievements)) {
    fail("community dashboard did not return streaks, leaderboards and achievements");
  }
}

async function checkRewardsMath(baseUrl) {
  const before = await request(baseUrl, "/rewards/me");
  const createdCatch = await request(baseUrl, "/catches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      species: "Rewards Audit Snapper",
      species_confirmed: true,
      notes: "Automated rewards audit.",
    }),
  });
  const catchPoints = (createdCatch.rewards || [])
    .filter((row) => row.awarded)
    .reduce((sum, row) => sum + Number(row.points || 0), 0);
  if (catchPoints !== 15) fail(`expected catch rewards of 15, got ${catchPoints}`);

  const post = await request(baseUrl, "/community/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      species: "Trip report",
      caption: "Trip report automated rewards audit.",
      general_area: "Audit area",
      privacy: "public",
    }),
  });
  const postPoints = (post.rewards || [])
    .filter((row) => row.awarded)
    .reduce((sum, row) => sum + Number(row.points || 0), 0);
  if (postPoints !== 22) fail(`expected trip-report rewards of 22, got ${postPoints}`);

  const comment = await request(baseUrl, `/community/posts/${post.post.id}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Useful rewards audit comment." }),
  });
  const commentPoints = (comment.rewards || [])
    .filter((row) => row.awarded)
    .reduce((sum, row) => sum + Number(row.points || 0), 0);
  if (commentPoints !== 1) fail(`expected comment rewards of 1, got ${commentPoints}`);

  const after = await request(baseUrl, "/rewards/me");
  const delta = Number(after.balance || 0) - Number(before.balance || 0);
  if (delta !== 38) fail(`expected total reward delta of 38, got ${delta}`);

  const reconciled = await request(baseUrl, "/rewards/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (Number(reconciled.awarded_points || 0) !== 0) {
    fail(`reward reconciliation duplicated points: ${reconciled.awarded_points}`);
  }
}

async function checkTwoUserSocialFlow(baseUrl) {
  const id = n => "00000000-0000-0000-0000-00000000000"+n;
  const as = (actor, route, method="GET", body) => request(baseUrl, route, {
    method,
    headers: {"Content-Type":"application/json","x-audit-user":String(actor),"Authorization":"Bearer audit-fixture"},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  const denied = async (actor, route, method, body) => {
    try { await as(actor,route,method,body); }
    catch(error) { if([403,404].includes(error.status)) return; throw error; }
    fail("Unauthorized social action was allowed: "+route);
  };
  await denied(1,"/community/messages/conversations","POST",{recipient_id:id(2)});
  await as(1,"/community/friends/"+id(2),"POST",{});
  const pending = await as(2,"/community/friends");
  if(!pending.requests.some(row=>row.other_id===id(1)&&row.direction==="incoming")) fail("Recipient did not receive friend request");
  await denied(3,"/community/friends/"+id(1),"PATCH",{});
  await as(2,"/community/friends/"+id(1),"PATCH",{});
  const started=await as(1,"/community/messages/conversations","POST",{recipient_id:id(2)});
  const route="/community/messages/conversations/"+started.conversation.id;
  await as(1,route,"POST",{body:"Audit hello from the first member"});
  const received=await as(2,route);
  if(!received.messages.some(row=>row.body==="Audit hello from the first member")) fail("Recipient cannot read sent message");
  const held = await as(1,route,"POST",{body:"Review this https://example.com/offer"});
  if(!held.held_for_review) fail("Unsafe message was not held");
  if((await as(2,route)).messages.some(row=>row.id===held.message.id)) fail("Held message leaked to recipient");
  if(!(await as(1,route)).messages.some(row=>row.id===held.message.id)) fail("Sender cannot see review status");
  const recipientInbox=await as(2,"/community/messages/conversations");
  if(recipientInbox.conversations.some(row=>row.last_message===held.message.body)) fail("Held message leaked through preview");
  await denied(3,route,"GET");
  await denied(3,route,"POST",{body:"Unrelated member must not send here"});
  await as(2,"/community/users/"+id(1)+"/block","POST",{});
  await denied(1,route,"POST",{body:"Blocked message"});
  await denied(1,"/community/friends/"+id(2),"POST",{});
}

await check("two-user friendship, messages and third-user isolation", () => runTemporaryMemoryBackend(checkTwoUserSocialFlow));
await check("frontend integrity", checkFrontendIntegrity);
await check("frontend/backend route integrity", checkRouteIntegrity);
await check("Supabase schema integrity", checkSchemaIntegrity);
await check("Boat AI math on disposable backend", () => runTemporaryMemoryBackend(checkBoatMath));
await check("catch privacy on disposable backend", () =>
  runTemporaryMemoryBackend((baseUrl) => checkCatchPrivacy(baseUrl))
);
await check("community moderation on disposable backend", () =>
  runTemporaryMemoryBackend((baseUrl) => checkCommunityModeration(baseUrl))
);
await check("Community 2.0 foundation on disposable backend", () =>
  runTemporaryMemoryBackend((baseUrl) => checkCommunityTwoFoundation(baseUrl))
);
await check("OceanPoints math and duplicate prevention", () =>
  runTemporaryMemoryBackend((baseUrl) => checkRewardsMath(baseUrl))
);

if (process.exitCode) {
  console.error("Full audit failed.");
  process.exit(process.exitCode);
}

console.log("Full audit passed.");
