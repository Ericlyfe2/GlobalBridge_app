import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiGuard, tooLarge, totalChars } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { extractJson } from "../../lib/ai/json";
import { translateSystem, LANG_NAMES } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";
import { normalizeLocale } from "../../lib/i18n";

export const translateRouter = Router();

const MAX_TRANSLATE_CHARS = 20_000;
const MAX_TRANSLATE_ITEMS = 200;

const bodySchema = z.object({
  texts: z.array(z.string().max(5_000)).max(MAX_TRANSLATE_ITEMS * 2),
  target: z.string().min(2).max(10),
});

/**
 * Batch UI translation.
 *
 * ── Why every failure returns the source strings ──────────────────────────
 * The caller is rendering a screen. If this endpoint errors, the screen has
 * nothing to draw; if it returns English, the screen draws in English. An
 * untranslated interface is a bad experience, a blank one is a broken app. So
 * every path here returns strings of the right length, and flags the degraded
 * ones so the client can retry later rather than caching English as the
 * translation.
 */
translateRouter.post("/", requireAuth, aiGuard("translate"), async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body);

    const locale = normalizeLocale(body.target);

    // English target, or nothing to do. No spend, no round trip.
    if (locale === "en" || body.texts.length === 0) {
      return res.json({ translations: body.texts, target: locale });
    }

    if (body.texts.length > MAX_TRANSLATE_ITEMS) {
      return res.status(400).json({
        error: `Too many strings in one request (max ${MAX_TRANSLATE_ITEMS}).`,
        code: "translate/too-many-items",
      });
    }
    if (totalChars(body.texts) > MAX_TRANSLATE_CHARS) return tooLarge(res, MAX_TRANSLATE_CHARS);

    const config = await getAiConfig();

    if (!aiConfigured || !config.ai_translation_enabled) {
      return res.json({
        translations: body.texts,
        target: locale,
        degraded: true,
        note: "translation-unavailable",
      });
    }

    try {
      // Numbered lines, JSON array back. Numbering is what lets a mismatch be
      // detected: the model returning 19 strings for 20 inputs would otherwise
      // shift every label on the screen by one.
      const numbered = body.texts.map((t, i) => `${i}: ${t}`).join("\n");

      const completion = await chatCompletion({
        model: config.ai_model,
        maxTokens: 4096,
        messages: [
          { role: "system", content: translateSystem(LANG_NAMES[locale] ?? locale) },
          { role: "user", content: numbered },
        ],
      });

      await recordUsage({
        userId: req.user!.sub,
        feature: "translate",
        model: config.ai_model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        responseTimeMs: completion.responseTimeMs,
      });

      const parsed = extractJson(completion.text);
      const ok =
        Array.isArray(parsed) &&
        parsed.length === body.texts.length &&
        parsed.every((s) => typeof s === "string");

      if (!ok) {
        console.error("[ai/translate] unusable response shape");
        return res.json({
          translations: body.texts,
          target: locale,
          degraded: true,
          note: "translation-unavailable",
        });
      }

      // UI strings are not user data and are identical for every caller asking
      // for the same batch, but the request body varies too much for a shared
      // cache to help. The client caches its own bundle.
      res.set("Cache-Control", "no-store");
      return res.json({ translations: parsed as string[], target: locale });
    } catch (err) {
      await recordUsage({
        userId: req.user!.sub,
        feature: "translate",
        model: config.ai_model,
        error: (err as Error).message.slice(0, 500),
      });
      console.error("[ai/translate]", (err as Error).message);
      return res.json({
        translations: body.texts,
        target: locale,
        degraded: true,
        note: "translation-unavailable",
      });
    }
  } catch (err) {
    next(err);
  }
});
