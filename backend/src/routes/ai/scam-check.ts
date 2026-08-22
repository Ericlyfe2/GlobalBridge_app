import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiGuard, tooLarge } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { extractJson } from "../../lib/ai/json";
import { SCAM_CHECK_SYSTEM } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";
import {
  scamFallback,
  scamDisabled,
  normalizeScam,
  type ScamResult,
} from "../../lib/ai/fallbacks";

export const scamCheckRouter = Router();

const MAX_TEXT_CHARS = 6_000;

const bodySchema = z.object({
  text: z.string().min(1, "Paste the message you want checked").max(MAX_TEXT_CHARS * 2),
  kind: z.enum(["listing", "job", "scholarship", "message", "email"]).optional(),
});

/**
 * Scam Shield.
 *
 * The most safety-critical endpoint in the product, and the reason the disabled
 * and degraded paths below are written the way they are. Everything else here
 * can fail by saying "unavailable"; this one cannot, because the user is
 * standing in front of a decision about whether to send someone money. Silence
 * from a safety tool reads as approval.
 *
 * So there is no path through this handler that returns "Likely safe" without a
 * real analysis having happened.
 */
scamCheckRouter.post("/", requireAuth, aiGuard("scam-check"), async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body);
    const text = body.text.trim();

    if (text.length > MAX_TEXT_CHARS) return tooLarge(res, MAX_TEXT_CHARS);

    const config = await getAiConfig();

    if (!config.ai_scam_detection_enabled) return res.json(scamDisabled());
    if (!aiConfigured) return res.json(scamFallback(text));

    try {
      const completion = await chatCompletion({
        model: config.ai_model,
        maxTokens: 1200,
        messages: [
          { role: "system", content: SCAM_CHECK_SYSTEM },
          {
            role: "user",
            content:
              `Analyze this ${body.kind ?? "message"} for scam risk. ` +
              `Return strict JSON per the schema.\n\n"""\n${text}\n"""`,
          },
        ],
      });

      await recordUsage({
        userId: req.user!.sub,
        feature: "scam-check",
        model: config.ai_model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        responseTimeMs: completion.responseTimeMs,
      });

      const parsed = extractJson(completion.text) as ScamResult | null;
      if (!parsed || typeof parsed.score !== "number") {
        console.error("[ai/scam-check] non-JSON response:", completion.text.slice(0, 200));
        return res.json(scamFallback(text));
      }

      res.set("Cache-Control", "no-store");
      return res.json({
        ...normalizeScam(parsed),
        usage: { input_tokens: completion.inputTokens, output_tokens: completion.outputTokens },
      });
    } catch (err) {
      // Book the failed call: a provider outage that burns tokens on a retry
      // storm should still be visible in the ledger.
      await recordUsage({
        userId: req.user!.sub,
        feature: "scam-check",
        model: config.ai_model,
        error: (err as Error).message.slice(0, 500),
      });
      console.error("[ai/scam-check]", (err as Error).message);
      res.set("Cache-Control", "no-store");
      return res.json(scamFallback(text));
    }
  } catch (err) {
    next(err);
  }
});
