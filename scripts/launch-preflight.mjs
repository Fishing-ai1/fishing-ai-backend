import path from "node:path";
import { spawn } from "node:child_process";

const backendRoot = path.resolve(import.meta.dirname, "..");
const API_URL = (process.env.API_URL || "").replace(/\/+$/, "");
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL || "";
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD || "";
const SMOKE_EMAIL = process.env.SMOKE_EMAIL || REVIEWER_EMAIL;
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || REVIEWER_PASSWORD;
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  throw new Error(message);
}

function productionOrigin() {
  if (!API_URL) fail("set API_URL to your deployed production backend, e.g. https://api.example.com");
  let parsed;
  try {
    parsed = new URL(API_URL);
  } catch {
    fail(`API_URL is not a valid URL: ${API_URL}`);
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  if (parsed.protocol !== "https:") fail("launch preflight requires API_URL to use https");
  if (localHosts.has(parsed.hostname)) fail("launch preflight requires a deployed production API_URL, not localhost");
  if (/your-production-backend|example\.com/i.test(parsed.hostname)) fail("replace the placeholder API_URL with the real production backend");
  return parsed.origin.replace(/\/+$/, "");
}

function validateEnv() {
  const origin = productionOrigin();
  if (!REVIEWER_EMAIL || !REVIEWER_PASSWORD) {
    fail("set REVIEWER_EMAIL and REVIEWER_PASSWORD for the dedicated app-review account");
  }
  if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
    fail("set SMOKE_EMAIL and SMOKE_PASSWORD, or let them fall back to reviewer credentials");
  }

  console.log("OceanCore launch preflight");
  console.log(`API: ${origin}`);
  console.log(`Reviewer: ${REVIEWER_EMAIL}`);
  console.log(`Smoke account: ${SMOKE_EMAIL}`);
  console.log("Passwords are read from environment variables and are not printed.");
}

function runStep(label, args, extraEnv = {}) {
  console.log("");
  console.log(`==> ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(npmCmd, args, {
      cwd: backendRoot,
      env: {
        ...process.env,
        API_URL,
        ...extraEnv,
      },
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code}`));
      }
    });
  });
}

async function main() {
  validateEnv();

  await runStep("Finalize store metadata", ["run", "store:metadata"]);

  await runStep("Prepare reviewer account", ["run", "reviewer:prepare"], {
    REVIEWER_EMAIL,
    REVIEWER_PASSWORD,
  });

  await runStep("Strict authenticated smoke", ["run", "smoke"], {
    SMOKE_EMAIL,
    SMOKE_PASSWORD,
    STRICT_CLOUD_SMOKE: "true",
  });

  await runStep("Full production audit", ["run", "audit:full"]);

  await runStep("Strict store readiness", ["run", "store:check"], {
    REVIEWER_EMAIL,
    REVIEWER_PASSWORD,
    SMOKE_EMAIL,
    SMOKE_PASSWORD,
    STRICT_STORE_CHECK: "true",
  });

  await runStep("Dependency security audit", ["audit", "--audit-level=moderate"]);

  console.log("");
  console.log("Launch preflight passed. Store metadata, production backend, reviewer account, smoke tests, audit, store gate, and dependency audit are green.");
}

await main().catch((error) => {
  console.error("");
  console.error(`fail - launch preflight: ${error.message}`);
  process.exitCode = 1;
});
