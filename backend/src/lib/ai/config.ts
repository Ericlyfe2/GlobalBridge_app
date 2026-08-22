import { query } from "../../db";
import { MODEL_PRICING_USD_PER_MTOK } from "./pricing";

/**
 * Admin-owned AI configuration, read from platform_settings.
 *
 * Read straight from the database. In the previous architecture this was an
 * HTTP call from the Next.js runtime to the API for a row the API already had
 * — a network hop, a timeout to handle, and a second cache to invalidate, all
 * to read one table. Collapsing that is most of the value of the port.
 *
 * Cached briefly per process: these change rarely and every chat message would
 * otherwise cost a query.
 */

export type AiConfig = {
  ai_model: string;
  ai_temperature: number;
  ai_system_prompt: string;
  ai_chat_enabled: boolean;
  ai_doc_check_enabled: boolean;
  ai_scam_detection_enabled: boolean;
  ai_translation_enabled: boolean;
};

/** Last-resort model when the configured one cannot be used. Cheap and known-priced. */
export const SAFE_DEFAULT_MODEL = "gpt-4o-mini";

const DEFAULTS: AiConfig = {
  ai_model: process.env.OPENAI_MODEL || SAFE_DEFAULT_MODEL,
  ai_temperature: 0.3,
  ai_system_prompt: "",
  ai_chat_enabled: true,
  ai_doc_check_enabled: true,
  ai_scam_detection_enabled: true,
  ai_translation_enabled: true,
};

const CACHE_TTL_MS = 15_000;
let cached: { value: AiConfig; expires: number } | null = null;

/** Test seam, and the hook an admin settings write should call. */
export function clearAiConfigCache(): void {
  cached = null;
}

let warnedAboutModel: string | null = null;

/**
 * Refuse a model this client cannot actually call.
 *
 * The web platform's settings seed shipped `ai_model = "claude-haiku-4-5"`
 * while the calling code speaks the OpenAI chat-completions API. Every request
 * failed at the provider and fell into the mock fallback, so the product
 * *looked* like a working AI that gave suspiciously generic answers — the
 * hardest kind of failure to notice, because nothing errors.
 *
 * The check is provider-shaped rather than an allow-list of exact ids: new
 * OpenAI models appear faster than this file is edited, and refusing a valid
 * new model would be its own outage. What it catches is a model from a
 * *different provider*, which is the mistake that actually happened.
 */
function coerceModel(model: string): string {
  const looksOpenAI = /^(gpt-|o\d|text-embedding-|chatgpt-)/i.test(model);
  if (looksOpenAI) return model;

  if (warnedAboutModel !== model) {
    warnedAboutModel = model;
    console.error(
      `⚠ platform_settings.ai_model is "${model}", which is not an OpenAI model id. ` +
        `The AI client speaks the OpenAI API, so every call would fail and silently ` +
        `fall back to canned output. Using "${SAFE_DEFAULT_MODEL}" instead — fix the ` +
        `setting in the admin AI Control Center.`,
    );
  }
  return SAFE_DEFAULT_MODEL;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getAiConfig(): Promise<AiConfig> {
  if (cached && cached.expires > Date.now()) return cached.value;

  const value: AiConfig = { ...DEFAULTS };

  try {
    const rows = await query<{ key: string; value: unknown }>(
      `SELECT key, value FROM platform_settings WHERE key = ANY($1)`,
      [Object.keys(DEFAULTS)],
    );

    for (const row of rows) {
      switch (row.key) {
        case "ai_model":
          value.ai_model = asString(row.value, DEFAULTS.ai_model);
          break;
        case "ai_temperature":
          // Clamped: a temperature outside [0,2] is rejected by the provider,
          // which would take the whole surface down from one bad admin input.
          value.ai_temperature = Math.max(0, Math.min(2, asNumber(row.value, DEFAULTS.ai_temperature)));
          break;
        case "ai_system_prompt":
          value.ai_system_prompt = typeof row.value === "string" ? row.value : "";
          break;
        case "ai_chat_enabled":
          value.ai_chat_enabled = asBool(row.value, true);
          break;
        case "ai_doc_check_enabled":
          value.ai_doc_check_enabled = asBool(row.value, true);
          break;
        case "ai_scam_detection_enabled":
          value.ai_scam_detection_enabled = asBool(row.value, true);
          break;
        case "ai_translation_enabled":
          value.ai_translation_enabled = asBool(row.value, true);
          break;
      }
    }
  } catch {
    // Settings unreachable. Falling back to defaults keeps the AI working
    // through a database blip; failing here would take the whole surface down
    // over a table nobody was writing to.
  }

  value.ai_model = coerceModel(value.ai_model);
  cached = { value, expires: Date.now() + CACHE_TTL_MS };
  return value;
}

/** True when the configured model has a real price entry rather than the punitive fallback. */
export function isPricedModel(model: string): boolean {
  return model in MODEL_PRICING_USD_PER_MTOK;
}
