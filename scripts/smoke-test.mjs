const API_URL = (process.env.API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const EMAIL = process.env.SMOKE_EMAIL || "";
const PASSWORD = process.env.SMOKE_PASSWORD || "";
const STRICT_CLOUD_SMOKE = process.env.STRICT_CLOUD_SMOKE === "true";

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
    const err = new Error(`${path}: ${message}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function check(name, fn) {
  try {
    const data = await fn();
    console.log(`ok - ${name}`);
    return data;
  } catch (err) {
    console.error(`fail - ${name}: ${err.message}`);
    process.exitCode = 1;
    return null;
  }
}

const health = await check("health", () => request("/health"));
await check("legal docs", () => request("/legal/docs"));
await check("public legal pages", async () => {
  for (const path of ["/legal/privacy-policy", "/legal/terms-of-service", "/legal/account-deletion", "/legal/marine-disclaimer"]) {
    const res = await fetch(`${API_URL}${path}`, { headers: { Accept: "text/html" } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes("OceanCore AI")) throw new Error(`${path}: missing OceanCore AI`);
    if (!html.includes("support@oceancore.ai")) throw new Error(`${path}: missing support contact`);
  }
  return true;
});
await check("billing plans", () => request("/billing/plans"));
await check("community feed", async () => {
  const data = await request("/api/community/posts");
  if (STRICT_CLOUD_SMOKE && health?.supabase && data.storage !== "supabase") {
    throw new Error(`community storage is ${data.storage || "unknown"}; run Supabase schema.sql before launch`);
  }
  return data;
});
await check("debug routes", async () => {
  const data = await request("/__debug/routes");
  const routes = data.routes || [];
  for (const route of ["/api/community/posts", "/api/geocode/search", "/auth/export-data", "/auth/settings", "/app/", "/legal/privacy-policy", "/legal/account-deletion"]) {
    if (!routes.includes(route)) throw new Error(`missing ${route}`);
  }
  for (const route of ["/api/satellite-intel/scan", "/api/tactical/snapshot", "/ai/tactical/snapshot", "/api/ocean/snapshot", "/api/ripstyle/snapshot"]) {
    if (routes.includes(route)) throw new Error(`removed route still exposed: ${route}`);
  }
  return data;
});

if (health?.frontend_app_available) {
  await check("frontend app served", async () => {
    const res = await fetch(`${API_URL}/app/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes("OceanCore AI")) throw new Error("index.html did not load");
    return true;
  });
}

if (EMAIL && PASSWORD) {
  const login = await check("login", () =>
    request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
  );
  const token = login?.session?.access_token;
  if (token) {
    const authHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    await check("auth me", () => request("/auth/me", { headers: authHeaders }));
    await check("account settings", async () => {
      const seed = {
        map: { defaultView: "windy", defaultOverlay: "waves", defaultRadiusKm: 35 },
        ai: { answerStyle: "practical", saveChatHistory: true },
      };
      const saved = await request("/auth/settings", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ settings: seed }),
      });
      if (saved?.settings?.map?.defaultOverlay !== "waves") throw new Error("settings patch did not round-trip");
      const loaded = await request("/auth/settings", { headers: authHeaders });
      if (loaded?.settings?.map?.defaultOverlay !== "waves") throw new Error("settings get did not round-trip");
      return loaded;
    });
    await check("billing me", () => request("/billing/me", { headers: authHeaders }));
    await check("export data", () => request("/auth/export-data", { headers: authHeaders }));

    await check("catch create/delete", async () => {
      let catchId = "";
      try {
        const marker = `smoke-${Date.now()}`;
        const created = await request("/catches", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            species: "Smoke Test Snapper",
            weight_kg: 1.23,
            length_cm: 32,
            legal_limit_cm: 30,
            lat: -27.5426,
            lng: 153.0908,
            general_area: "Smoke Test General Area",
            privacy: "general",
            notes: marker,
          }),
        });
        const row = created?.catch;
        catchId = row?.id || "";
        if (!catchId) throw new Error("created catch did not return an id");
        if (row.is_legal !== true) throw new Error("legal maths failed: 32cm should be legal against 30cm");
        if (row.general_area !== "Smoke Test General Area" || row.privacy !== "general") {
          throw new Error("catch privacy/general area did not round-trip");
        }

        const list = await request("/catches?limit=50", { headers: authHeaders });
        const listedCatch = Array.isArray(list.catches) ? list.catches.find((item) => item.id === catchId) : null;
        if (!listedCatch) {
          throw new Error("created catch was not returned by /catches");
        }
        if (listedCatch.general_area !== "Smoke Test General Area" || listedCatch.privacy !== "general") {
          throw new Error("listed catch lost privacy/general area; run Supabase schema.sql before launch");
        }

        const stats = await request("/api/stats", { headers: authHeaders });
        if (!stats?.stats || Number(stats.stats.total_catches || 0) < 1) {
          throw new Error("stats did not include catch totals");
        }

        return created;
      } finally {
        if (catchId) {
          await request(`/catches/${encodeURIComponent(catchId)}`, {
            method: "DELETE",
            headers: authHeaders,
          }).catch((error) => {
            console.error(`cleanup warning - catch ${catchId}: ${error.message}`);
          });
        }
      }
    });

    await check("saved area create/delete", async () => {
      const before = await request("/saved-areas", { headers: authHeaders });
      const count = Number(before.count ?? before.saved_areas?.length ?? 0);
      const limit = Number(before.limit || 0);
      if (limit > 0 && count >= limit) {
        console.log(`skip - saved area create/delete (test account is at saved-area limit ${count}/${limit})`);
        return before;
      }

      let areaId = "";
      try {
        const created = await request("/saved-areas", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: `Smoke Test Area ${Date.now()}`,
            area_type: "bay",
            lat: -27.5426,
            lng: 153.0908,
            radius_km: 5,
            general_area: "Smoke Test General Area",
            notes: "Created by smoke test and deleted immediately.",
            privacy: "private",
          }),
        });
        areaId = created?.saved_area?.id || "";
        if (!areaId) throw new Error("created saved area did not return an id");

        const after = await request("/saved-areas", { headers: authHeaders });
        if (!Array.isArray(after.saved_areas) || !after.saved_areas.some((item) => item.id === areaId)) {
          throw new Error("created saved area was not returned by /saved-areas");
        }

        return created;
      } finally {
        if (areaId) {
          await request(`/saved-areas/${encodeURIComponent(areaId)}`, {
            method: "DELETE",
            headers: authHeaders,
          }).catch((error) => {
            console.error(`cleanup warning - saved area ${areaId}: ${error.message}`);
          });
        }
      }
    });

    await check("community post create/delete", async () => {
      let postId = "";
      try {
        const created = await request("/api/community/posts", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            species: "Smoke Test Report",
            general_area: "Smoke Test General Area",
            caption: "Created by smoke test and deleted immediately.",
            privacy: "private",
            category: "reports",
            allow_comments: false,
            comment_permission: "off",
            hold_link_comments: true,
            blocked_words: "smoke-blocked-word",
            upload_quality: "standard",
          }),
        });
        const post = created?.post;
        postId = post?.id || "";
        if (STRICT_CLOUD_SMOKE && health?.supabase && created.storage !== "supabase") {
          throw new Error(`community write storage is ${created.storage || "unknown"}; run Supabase schema.sql before launch`);
        }

        if (!postId) throw new Error("created community post did not return an id");
        if (post.allow_comments !== false || post.comment_permission !== "off") {
          throw new Error("community comment settings did not round-trip");
        }

        const denied = await fetch(`${API_URL}/api/community/posts/${encodeURIComponent(postId)}/comments`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ body: "This should not be accepted." }),
        });
        if (denied.status !== 403) {
          const body = await readJson(denied);
          throw new Error(`comments-off post accepted comment status ${denied.status}: ${JSON.stringify(body)}`);
        }

        return created;
      } finally {
        if (postId) {
          await request(`/api/community/posts/${encodeURIComponent(postId)}`, {
            method: "DELETE",
            headers: authHeaders,
          }).catch((error) => {
            console.error(`cleanup warning - community post ${postId}: ${error.message}`);
          });
        }
      }
    });
  }
} else {
  console.log("skip - authenticated checks (set SMOKE_EMAIL and SMOKE_PASSWORD)");
}

if (process.exitCode) {
  console.error(`Smoke test failed against ${API_URL}`);
  process.exit(process.exitCode);
}

console.log(`Smoke test passed against ${API_URL}`);
