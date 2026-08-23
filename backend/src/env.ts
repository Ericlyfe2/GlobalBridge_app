import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

/**
 * Fail fast, at boot, with the full list of problems.
 *
 * A mobile client cannot be told "the server was misconfigured" in any useful
 * way — it just sees timeouts. Refusing to start is the honest failure.
 */

// `npm --workspace` runs every script with cwd set inside backend/, so a bare
// "dotenv/config" reads backend/.env and never the root .env that migrations
// open via ../.env. Resolving from this file lands on the same root .env in
// dev (src/) and production (dist/) regardless of cwd. Loaded here rather
// than in index.ts because imports hoist: env.ts would otherwise evaluate
// before any dotenv.config() call below it. Existing process.env values win,
// which is what tests rely on when they inject config before importing this.
dotenv.config({ path: path.join(__dirname, "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4100),

  DATABASE_URL: z.string().url().optional(),
  // Redis stays optional. Absent it, the WebSocket fan-out is single-instance
  // and rate-limit counters are per-process. The server must still boot.
  REDIS_URL: z.string().url().optional(),

  // Firebase Admin — identity provider for both REST and WebSocket.
  FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID is required"),
  FIREBASE_CLIENT_EMAIL: z.string().email("FIREBASE_CLIENT_EMAIL must be a valid email"),
  FIREBASE_PRIVATE_KEY: z.string().min(1, "FIREBASE_PRIVATE_KEY is required"),

  // Comma-separated. Native builds send no Origin at all; see middleware/csrf.ts.
  CORS_ORIGIN: z.string().default("http://localhost:3000,http://localhost:8081"),

  // ── Client version gate (§3.1) ──────────────────────────────────────────
  // Semver. A build below MIN_SUPPORTED_APP_VERSION is refused with 426 so it
  // can never silently talk to an API whose contract it predates.
  MIN_SUPPORTED_APP_VERSION: z.string().default("1.0.0"),
  LATEST_APP_VERSION: z.string().default("1.0.0"),
  APP_UPDATE_URL_IOS: z.string().default("https://apps.apple.com/app/globalbridge/id000000000"),
  APP_UPDATE_URL_ANDROID: z.string().default("https://play.google.com/store/apps/details?id=app.globalbridge"),
  MAINTENANCE_MODE: z.coerce.boolean().default(false),

  // Web push (optional, mirrors the existing VAPID behaviour: warn once, no-op)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@globalbridge.app"),

  // Native push. Reuses the Firebase Admin app — no extra credential needed —
  // but is gated by an explicit flag so a project without FCM enabled degrades
  // to a warned no-op instead of throwing on every notification.
  FCM_ENABLED: z.coerce.boolean().default(false),

  OPENAI_API_KEY: z.string().optional(),

  // ── Object storage (§3.8) ────────────────────────────────────────────────
  // Any S3-compatible store: AWS S3, Cloudflare R2, Backblaze B2, MinIO.
  // Without S3_BUCKET the upload endpoints report themselves unavailable
  // rather than accepting identity documents onto a disk the next deploy
  // destroys.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),

  // ── Reminders (§3.7) ─────────────────────────────────────────────────────
  // Off by default. The scheduler sends push notifications, so switching it on
  // is a deliberate act -- a misconfigured staging instance pointed at the
  // production database would otherwise notify real users.
  REMINDERS_ENABLED: z.coerce.boolean().default(false),
  REMINDER_CRON: z.string().default("*/15 * * * *"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
