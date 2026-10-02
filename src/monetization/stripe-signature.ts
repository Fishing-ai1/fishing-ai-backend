import crypto from "node:crypto";

export function verifyStripeSignature(rawBody: string, header: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !rawBody || !header) return false;
  const pairs = header.split(",").map((part) => part.trim().split("="));
  const timestamp = pairs.find(([key]) => key === "t")?.[1];
  const signatures = pairs.filter(([key, value]) => key === "v1" && !!value).map(([, value]) => value);
  const eventSeconds = Number(timestamp);
  if (!timestamp || !Number.isSafeInteger(eventSeconds) || Math.abs(nowSeconds - eventSeconds) > 300 || !signatures.length) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  return signatures.some((signature) => /^[a-f0-9]{64}$/i.test(signature) && crypto.timingSafeEqual(expected, Buffer.from(signature, "hex")));
}
