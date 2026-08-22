import type { Request, Response, NextFunction } from "express";
import { env } from "../env";
import { isBelowMinimum, parseVersion } from "../lib/version";

/**
 * The minimum-version gate.
 *
 * A web client updates on refresh. A mobile binary does not -- an old build can
 * sit on a phone for months, and the store review queue means "just ship a fix"
 * is measured in days. So the API has to be able to say "this build can no
 * longer talk to me" in a way the client is guaranteed to understand, and it
 * has to be able to say it *before* the request reaches a handler whose
 * contract that build predates.
 *
 * 426 Upgrade Required, not 400 or 403: it is the one status whose meaning is
 * exactly this, and it will not be confused with an auth failure by a client
 * that is already handling 401 by refreshing a token.
 */

export const UPDATE_REQUIRED_CODE = "client/update-required";

const KNOWN_PLATFORMS = new Set(["ios", "android", "web"]);

export type ClientInfo = {
  platform: "ios" | "android" | "web" | null;
  version: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      client?: ClientInfo;
    }
  }
}

function updateUrlFor(platform: string | null): string {
  if (platform === "ios") return env.APP_UPDATE_URL_IOS;
  if (platform === "android") return env.APP_UPDATE_URL_ANDROID;
  return env.APP_UPDATE_URL_ANDROID;
}

/**
 * Paths that must answer even to a build we are about to refuse.
 *
 * app-config is how the client learns *why* it was refused and where to get the
 * update; health is how a load balancer and the app's own connectivity check
 * distinguish "server is down" from "your build is too old". Gating either
 * behind the gate itself would leave an outdated app with a blocking error
 * screen it cannot populate.
 */
const ALWAYS_ALLOWED = [/^\/api(?:\/v1)?\/app-config\/?$/, /^\/health\/?$/, /^\/api\/v1\/health\/?$/];

export function clientVersionGate(req: Request, res: Response, next: NextFunction) {
  const rawPlatform = String(req.headers["x-client-platform"] ?? "").toLowerCase();
  const rawVersion = String(req.headers["x-client-version"] ?? "").trim();

  req.client = {
    platform: KNOWN_PLATFORMS.has(rawPlatform) ? (rawPlatform as ClientInfo["platform"]) : null,
    version: rawVersion || null,
  };

  if (ALWAYS_ALLOWED.some((re) => re.test(req.path))) return next();

  // No version header at all: the web frontend and server-to-server callers.
  // Refusing them would break every existing consumer to gate a client that
  // does not exist yet, so an absent header is explicitly not "too old".
  if (!req.client.version || !req.client.platform || req.client.platform === "web") return next();

  // An unparseable version is a bug in the client, not necessarily an old
  // build. Refusing it with 426 would tell the user to update to fix something
  // an update will not fix, so let it through and let the handler answer.
  if (!parseVersion(req.client.version)) return next();

  if (isBelowMinimum(req.client.version, env.MIN_SUPPORTED_APP_VERSION)) {
    return res.status(426).json({
      error: "This version of the app is no longer supported",
      code: UPDATE_REQUIRED_CODE,
      minSupportedVersion: env.MIN_SUPPORTED_APP_VERSION,
      latestVersion: env.LATEST_APP_VERSION,
      updateUrl: updateUrlFor(req.client.platform),
    });
  }

  next();
}

/**
 * Maintenance mode, checked after the version gate so a client that is both too
 * old and hitting a maintenance window is told to update -- the actionable one.
 *
 * 503 with Retry-After, because that is what a client's backoff logic already
 * keys on.
 */
export function maintenanceGate(req: Request, res: Response, next: NextFunction) {
  if (!env.MAINTENANCE_MODE) return next();
  if (ALWAYS_ALLOWED.some((re) => re.test(req.path))) return next();

  res.set("Retry-After", "300");
  return res.status(503).json({
    error: "GlobalBridge is briefly unavailable while we make an update",
    code: "server/maintenance",
  });
}
