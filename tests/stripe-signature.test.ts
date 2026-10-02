import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyStripeSignature } from "../src/monetization/stripe-signature.ts";

const secret = "whsec_test";
const body = '{"id":"evt_test"}';
const now = 1_800_000_000;
const digest = (payload: string) => crypto.createHmac("sha256", secret).update(`${now}.${payload}`).digest("hex");

test("Stripe signatures require the secret, unchanged body and a recent timestamp", () => {
  const header = `t=${now},v1=${digest(body)}`;
  assert.equal(verifyStripeSignature(body, header, secret, now), true);
  assert.equal(verifyStripeSignature(body, header, "", now), false);
  assert.equal(verifyStripeSignature(`${body} `, header, secret, now), false);
  assert.equal(verifyStripeSignature(body, header, secret, now + 301), false);
});
