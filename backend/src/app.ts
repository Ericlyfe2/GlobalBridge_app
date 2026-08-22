import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";

import { env } from "./env";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { csrfProtection } from "./middleware/csrf";
import { clientVersionGate, maintenanceGate } from "./middleware/client-version";

import { appConfigRouter } from "./routes/app-config";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { housingRouter } from "./routes/housing";
import { opportunitiesRouter } from "./routes/opportunities";
import { messagesRouter } from "./routes/messages";
import { contentRouter } from "./routes/content";

/**
 * The app is built by a factory rather than at module scope so tests can boot it
 * without binding a port, and so nothing here depends on import order.
 */

const ALLOWED_ORIGINS = (env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Every router, mounted twice.
 *
 * `/api/v1/*` is the contract mobile clients bind to. The unversioned paths are
 * permanent aliases, not a deprecation with a date on it: the existing web
 * frontend proxies to them, and breaking that to introduce a version namespace
 * would be a self-inflicted outage. They are the same router object -- one
 * implementation, two mount points, so they cannot drift.
 */
function mountRouters(app: Express) {
  const routers: Array<[string, express.Router]> = [
    ["/app-config", appConfigRouter],
    ["/auth", authRouter],
    ["/users", usersRouter],
    ["/housing", housingRouter],
    ["/opportunities", opportunitiesRouter],
    ["/messages", messagesRouter],
    ["/content", contentRouter],
  ];

  for (const [path, router] of routers) {
    app.use(`/api/v1${path}`, router);
    app.use(`/api${path}`, router);
  }
}

export function createApp(): Express {
  const app = express();

  // Behind Railway/Vercel/any proxy. Without this, req.ip is the proxy's
  // address and every user in the world shares one rate-limit bucket.
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
      // This API serves JSON to a native client; it is not a document origin.
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );

  app.use(compression());
  if (env.NODE_ENV !== "test") app.use(morgan("dev"));

  /**
   * CORS.
   *
   * CORS_ORIGIN is a comma-separated list and must be split before it reaches
   * cors(): passing the raw string emits one malformed
   * `Access-Control-Allow-Origin: http://a,http://b` header, which no browser
   * accepts, and multi-origin CORS then fails for every origin at once.
   *
   * A production native build sends no Origin header at all -- it is not a web
   * origin and there is nothing for the browser same-origin policy to protect.
   * Expo's dev client does send one (http://localhost:8081), which is why that
   * belongs in the allow-list for development.
   */
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      // Mobile clients identify themselves with these on every request.
      allowedHeaders: ["Content-Type", "Authorization", "X-Client-Platform", "X-Client-Version"],
      exposedHeaders: ["Retry-After"],
    }),
  );

  /**
   * Rate limiting, keyed by authenticated user when there is one.
   *
   * Keying purely by IP is what forced the global budget up to an
   * uncomfortably high number: this audience sits behind campus and dorm NAT,
   * and carrier-grade NAT puts an entire city's mobile subscribers behind a
   * handful of addresses. A per-IP budget there is shared by strangers, so any
   * limit tight enough to matter locks out people who did nothing.
   *
   * Reading the user id off the *unverified* token is deliberate and safe: this
   * runs before auth, and a forged token only ever moves the request into a
   * bucket the attacker chose -- it cannot raise anyone's limit, and the
   * request still has to pass real verification afterwards. The alternative,
   * verifying here, would mean a signature check on every rejected request.
   *
   * NOTE: counters are per-process. With more than one instance this
   * under-counts by the instance count; backing it with Redis is the fix and is
   * not done here.
   */
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1200,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const header = req.headers.authorization;
        if (header?.startsWith("Bearer ")) {
          const parts = header.slice(7).split(".");
          if (parts.length === 3) {
            try {
              const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
              if (typeof claims.user_id === "string") return `u:${claims.user_id}`;
              if (typeof claims.sub === "string") return `u:${claims.sub}`;
            } catch {
              /* fall through to IP */
            }
          }
        }
        return `ip:${req.ip}`;
      },
      handler: (_req, res) => {
        res.set("Retry-After", "60");
        res.status(429).json({
          error: "You are doing that too quickly. Try again in a minute.",
          code: "rate/limited",
        });
      },
    }),
  );

  app.use(csrfProtection);
  app.use(clientVersionGate);
  app.use(maintenanceGate);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  /**
   * Liveness probe.
   *
   * Deliberately trivial and dependency-free: the app calls it to decide
   * whether it is actually reachable, because the OS connectivity flag reports
   * "connected" for a captive portal, a dorm network that resolves DNS and
   * nothing else, and a phone holding a dead LTE association. The only honest
   * answer to "am I online" is a real request that came back.
   */
  const health = (_req: express.Request, res: express.Response) =>
    res.json({ status: "ok", service: "globalbridge-mobile-api" });

  app.get("/health", health);
  app.get("/api/v1/health", health);
  app.head("/health", (_req, res) => res.status(200).end());
  app.head("/api/v1/health", (_req, res) => res.status(200).end());

  mountRouters(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
