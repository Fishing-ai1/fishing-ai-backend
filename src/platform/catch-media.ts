import { randomUUID } from 'node:crypto';
import { httpError } from './permissions.ts';

export const CATCH_BUCKET = 'oceancore-private-catches';
const PREFIX = 'oc-catch:';
const keyPattern = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$/i;
export function catchMediaKey(value: string, owner: string, storageUrl?: string): string {
  let key = value.startsWith(PREFIX) ? value.slice(PREFIX.length) : '';
  if (!key && storageUrl) {
    try {
      const url = new URL(value), base = new URL(storageUrl);
      const prefix = `/storage/v1/object/sign/${CATCH_BUCKET}/`;
      if (url.origin === base.origin && url.pathname.startsWith(prefix)) key = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {}
  }
  if (!keyPattern.test(key) || key.split('/')[0] !== owner) throw httpError('Upload a photo owned by this account.', 403);
  return key;
}
export async function uploadCatchMedia(db: any, owner: string, buffer: Buffer, mime: string, ext: string) {
  if (!db) throw httpError('Private photo storage is unavailable.', 503);
  const key = `${owner}/${randomUUID()}.${ext}`;
  catchMediaKey(PREFIX + key, owner);
  // Fail closed if an operator accidentally makes the bucket public.
  const bucket = await db.storage.getBucket(CATCH_BUCKET);
  if (bucket.error || !bucket.data || bucket.data.public !== false) throw httpError('Private photo storage is not configured.', 503);
  const result = await db.storage.from(CATCH_BUCKET).upload(key, buffer, { contentType: mime, cacheControl: '0', upsert: false });
  if (result.error) throw httpError('Photo could not be saved securely.', 503);
  return PREFIX + key;
}
export async function signCatchMedia(db: any, reference: string, owner: string) {
  const key = catchMediaKey(reference, owner);
  if (!db) throw httpError('Private photo storage is unavailable.', 503);
  const bucket = await db.storage.getBucket(CATCH_BUCKET);
  if (bucket.error || bucket.data?.public !== false) throw httpError('Private photo storage is not configured.', 503);
  const result = await db.storage.from(CATCH_BUCKET).createSignedUrl(key, 300);
  if (result.error || !result.data?.signedUrl) throw httpError('Photo could not be loaded securely.', 503);
  return result.data.signedUrl;
}
