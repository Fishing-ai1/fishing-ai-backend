# OceanCore AI Production Checklist

## Local test

1. Start the backend from `fishing-ai-backend`:

   ```powershell
   npm run dev
   ```

2. Open the app through the backend, not as a raw file:

   ```text
   http://localhost:4000/app/
   ```

3. Run the smoke test:

   ```powershell
   npm run smoke
   ```

4. Run the full local audit:

   ```powershell
   npm run audit:full
   ```

   This checks frontend integrity, frontend/backend route matching, Supabase community schema fields, Boat AI fuel maths, and community moderation behavior on a disposable local backend.

   Authenticated checks are optional:

   ```powershell
   $env:SMOKE_EMAIL="you@example.com"
   $env:SMOKE_PASSWORD="your-password"
   npm run smoke
   ```

   With credentials set, smoke creates and then deletes a test catch, saved area, and private community post. It also verifies settings sync, export data, stats totals, legal-size maths, and comments-off moderation.

## Supabase

Run `supabase/schema.sql` in the Supabase SQL editor. Then confirm these buckets exist:

- `catch-photos`
- `community-media`

The schema migration must include catch `general_area` and `privacy` fields, plus the community moderation fields, before strict cloud smoke is considered launch-ready.

## Required backend environment

```text
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_ANON_KEY=
OPENAI_API_KEY=
WINDY_POINT_FORECAST_KEY=
FRONTEND_URL=
ALLOWED_ORIGINS=
ADMIN_EMAILS=
TRUST_PROXY=true
NATIVE_APP_ORIGINS=capacitor://localhost,ionic://localhost,http://localhost,https://localhost
SECURITY_HEADERS=true
RATE_LIMITS=true
AVATAR_IMAGE_MAX_BYTES=5242880
CATCH_PHOTO_MAX_BYTES=12582912
COMMUNITY_MEDIA_MAX_BYTES=36700160
```

## Payments

Set these before turning on real subscriptions:

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER_MONTHLY=
STRIPE_PRICE_STARTER_YEARLY=
STRIPE_PRICE_BASIC_MONTHLY=
STRIPE_PRICE_BASIC_YEARLY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
```

## Deploy

1. Deploy the updated `server.ts`.
2. Set `FRONTEND_DIR` if the frontend is not beside the backend as `../fishing-ai-frontend`.
3. Visit `/health` and confirm:
   - `frontend_app_available: true`
   - `auth_api_configured: true`
   - `windy_point_forecast_configured: true`
   - `security_headers_enabled: true`
   - `rate_limits_enabled: true`
   - `native_app_origins` includes `https://localhost`
   - `upload_limits.catch_photo_max_bytes` and `upload_limits.community_media_max_bytes` are present
   - `upload_limits.strip_image_metadata: true`
4. Visit `/__debug/routes` and confirm `/api/community/posts`, `/auth/export-data`, and `/app/` are listed.
5. Run the one-command launch preflight against the deployed backend:

   ```powershell
   $env:API_URL="https://your-production-backend.example.com"
   $env:REVIEWER_EMAIL="app-review-account@example.com"
   $env:REVIEWER_PASSWORD="review-account-password"
   npm run launch:preflight
   ```

   This finalizes store metadata URLs, prepares the reviewer account, runs strict authenticated smoke, runs the full audit against production, runs strict store readiness, and runs `npm audit --audit-level=moderate`.

6. If you need to debug a failing gate, run the individual checks manually.

   Full production audit:

   ```powershell
   $env:API_URL="https://your-production-backend.example.com"
   npm run audit:full
   ```

   Strict cloud smoke:

   ```powershell
   $env:API_URL="https://your-production-backend.example.com"
   $env:SMOKE_EMAIL="you@example.com"
   $env:SMOKE_PASSWORD="your-password"
   $env:STRICT_CLOUD_SMOKE="true"
   npm run smoke
   ```

   Strict cloud smoke fails if community feed or community writes fall back to local storage while Supabase is configured.

   Store metadata finalization:

   ```powershell
   $env:API_URL="https://your-production-backend.example.com"
   npm run store:metadata
   ```

   Reviewer account prep:

   ```powershell
   $env:API_URL="https://your-production-backend.example.com"
   $env:REVIEWER_EMAIL="app-review-account@example.com"
   $env:REVIEWER_PASSWORD="review-account-password"
   npm run reviewer:prepare
   ```

   Set `REVIEWER_CREATE=true` only if you intentionally want the script to create the account first. If Supabase requires email confirmation, confirm the email before rerunning this prep.

   Strict store launch gate:

   ```powershell
   $env:API_URL="https://your-production-backend.example.com"
   $env:STRICT_STORE_CHECK="true"
   $env:REVIEWER_EMAIL="app-review-account@example.com"
   $env:REVIEWER_PASSWORD="review-account-password"
   npm run store:check
   ```

   Use a dedicated reviewer account, accept Terms, Privacy, and Marine Disclaimer on that account, and put those credentials in the store review form. Do not commit the password.

7. Point the frontend Connection field at the deployed backend, or open the app from `/app/` so it uses the same origin.

## App Store / PWA checks

1. Confirm these files load from the deployed origin:
   - `/app/manifest.webmanifest`
   - `/app/sw.js`
   - `/app/offline.html`
   - `/app/assets/icons/icon-512.png`
   - `/app/assets/icons/maskable-512.png`
   - `/app/assets/icons/apple-touch-icon.png`
   - `/legal/privacy-policy`
   - `/legal/terms-of-service`
   - `/legal/account-deletion`
   - `/legal/marine-disclaimer`
2. Install the PWA from Android Chrome and confirm it opens standalone.
3. Add the app to the iPhone Home Screen and confirm the Apple touch icon appears.
4. Verify the service worker does not cache account, auth, catch, community, billing, or API responses.
5. Use `../APP_STORE_READINESS.md` for native wrapper and store-submission tasks.
6. For native builds, prepare the wrapper from `../mobile-wrapper` with:

   ```powershell
   $env:OCEANCORE_API_URL="https://your-production-backend.example.com"
   npm run prepare:web
   npm run cap:sync
   ```
7. Confirm native/store privacy files are present:
   - `../mobile-wrapper/ios/App/App/PrivacyInfo.xcprivacy`
   - `../mobile-wrapper/store-metadata/app-privacy.json`
   - `../mobile-wrapper/store-metadata/play-data-safety.md`
   - `../mobile-wrapper/store-metadata/review-notes.md`
