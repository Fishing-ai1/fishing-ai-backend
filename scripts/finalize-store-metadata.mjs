import fs from "node:fs/promises";
import path from "node:path";

const API_URL = (process.env.API_URL || "").replace(/\/+$/, "");
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const metadataRoot = path.join(repoRoot, "mobile-wrapper", "store-metadata");

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
  if (parsed.protocol !== "https:") fail("store metadata requires API_URL to use https");
  if (localHosts.has(parsed.hostname)) fail("store metadata requires a deployed production API_URL, not localhost");
  if (/your-production-backend|example\.com/i.test(parsed.hostname)) fail("replace the placeholder API_URL with the real production backend");
  return parsed.origin.replace(/\/+$/, "");
}

async function readText(file) {
  return fs.readFile(path.join(metadataRoot, file), "utf8");
}

async function writeText(file, text) {
  await fs.writeFile(path.join(metadataRoot, file), text, "utf8");
}

function legalUrls(origin) {
  return {
    terms: `${origin}/legal/terms-of-service`,
    privacy: `${origin}/legal/privacy-policy`,
    deletion: `${origin}/legal/account-deletion`,
    disclaimer: `${origin}/legal/marine-disclaimer`,
  };
}

async function updateAppPrivacy(urls) {
  const file = "app-privacy.json";
  const data = JSON.parse(await readText(file));
  data.accountDeletionUrl = urls.deletion;
  data.privacyPolicyUrl = urls.privacy;
  data.termsUrl = urls.terms;
  await writeText(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function updatePlayDataSafety(origin, urls) {
  const file = "play-data-safety.md";
  let text = await readText(file);
  text = text.replace(
    "Use this as the first-pass Play Console data safety form source. Replace `YOUR-PRODUCTION-BACKEND` with the production domain before submission.",
    `Use this as the Play Console data safety form source for ${origin}.`
  );
  text = text.replace(/https:\/\/(?:YOUR-PRODUCTION-BACKEND|your-production-backend\.example\.com)(?=\/legal\/)/g, origin);
  text = text.replace(/`https:\/\/[^`]+\/legal\/account-deletion`/g, `\`${urls.deletion}\``);
  await writeText(file, text);
}

async function updateReviewNotes(urls) {
  const file = "review-notes.md";
  let text = await readText(file);
  text = text.replace(/- Terms of Service: .*/g, `- Terms of Service: \`${urls.terms}\``);
  text = text.replace(/- Privacy Policy: .*/g, `- Privacy Policy: \`${urls.privacy}\``);
  text = text.replace(/- Account Deletion and Data Rights: .*/g, `- Account Deletion and Data Rights: \`${urls.deletion}\``);
  text = text.replace(/- Marine Disclaimer: .*/g, `- Marine Disclaimer: \`${urls.disclaimer}\``);
  await writeText(file, text);
}

async function main() {
  const origin = productionOrigin();
  const urls = legalUrls(origin);

  await updateAppPrivacy(urls);
  await updatePlayDataSafety(origin, urls);
  await updateReviewNotes(urls);

  console.log("Store metadata finalized.");
  console.log(`Terms: ${urls.terms}`);
  console.log(`Privacy: ${urls.privacy}`);
  console.log(`Account deletion: ${urls.deletion}`);
  console.log(`Marine disclaimer: ${urls.disclaimer}`);
}

await main().catch((error) => {
  console.error(`fail - store metadata: ${error.message}`);
  process.exitCode = 1;
});
