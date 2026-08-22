import { Router } from "express";
import { env } from "../env";
import { queryOne } from "../db";
import { SUPPORTED_LOCALES } from "../lib/i18n";

export const appConfigRouter = Router();

/**
 * One call on cold start.
 *
 * This folds what used to be two round trips -- the version/feature gate and
 * the AI config -- into one, because on a mobile cold start every round trip is
 * paid on the worst network the user will have all day, in front of a splash
 * screen. Two sequential calls before the first screen renders is the
 * difference between an app that feels instant and one that feels broken.
 *
 * Public and cacheable for 60s. It deliberately contains nothing user-specific,
 * which is what makes it safe to cache in a shared store at all -- the moment
 * anything here varied per user this header would have to go.
 */

type FeatureFlags = Record<string, boolean>;
type AiFeatureConfig = { enabled: boolean; model: string | null };

const DEFAULT_FEATURES: FeatureFlags = {
  aiAssistant: true,
  scamShield: true,
  documentChecker: true,
  visaRoadmap: true,
  readinessScore: true,
  essayReview: true,
  countryCompare: true,
  translate: true,
  housing: true,
  jobs: true,
  mentorship: true,
  community: true,
  messaging: true,
  push: true,
};

const AI_FEATURES = [
  "chat",
  "scamCheck",
  "visaRoadmap",
  "readiness",
  "docCheck",
  "scoreEssay",
  "compareCountries",
  "translate",
] as const;

/**
 * Flags live in platform_settings so the admin AI Control Center can turn a
 * feature off without a deploy. Absent the table or the row -- a fresh database,
 * or a deployment where the admin console has never been opened -- the defaults
 * above apply. Failing closed here would mean a database hiccup takes the whole
 * app dark; failing open means a feature stays on slightly longer than intended.
 */
async function loadSettings(): Promise<{ features: FeatureFlags; aiConfig: Record<string, AiFeatureConfig> }> {
  const features = { ...DEFAULT_FEATURES };
  const aiConfig: Record<string, AiFeatureConfig> = {};
  for (const name of AI_FEATURES) aiConfig[name] = { enabled: true, model: null };

  try {
    const row = await queryOne<{ value: unknown }>(
      `SELECT value FROM platform_settings WHERE key = $1`,
      ["mobile_app_config"],
    );
    const value = row?.value as { features?: FeatureFlags; aiConfig?: Record<string, AiFeatureConfig> } | undefined;
    if (value?.features) Object.assign(features, value.features);
    if (value?.aiConfig) {
      for (const [name, cfg] of Object.entries(value.aiConfig)) {
        if (name in aiConfig) aiConfig[name] = { ...aiConfig[name], ...cfg };
      }
    }
  } catch {
    /* defaults stand -- see comment above */
  }

  return { features, aiConfig };
}

appConfigRouter.get("/", async (req, res, next) => {
  try {
    const { features, aiConfig } = await loadSettings();

    res.set("Cache-Control", "public, max-age=60");
    res.json({
      minSupportedVersion: env.MIN_SUPPORTED_APP_VERSION,
      latestVersion: env.LATEST_APP_VERSION,
      updateUrl:
        req.client?.platform === "ios" ? env.APP_UPDATE_URL_IOS : env.APP_UPDATE_URL_ANDROID,
      maintenanceMode: env.MAINTENANCE_MODE,
      features,
      aiConfig,
      locales: SUPPORTED_LOCALES,
      // Where the app opens its socket. Shipping it here rather than deriving it
      // from the API URL in the client means the transport can move without a
      // store release.
      websocketPath: "/ws",
      // The minimum interval the app is allowed to poll at. Paired with the
      // rate limiter: a background-refreshing app spends request budget with no
      // human present, and this is the number that keeps that bounded.
      minPollIntervalSeconds: 60,
    });
  } catch (err) {
    next(err);
  }
});
