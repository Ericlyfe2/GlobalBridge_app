import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiGuard, tooLarge, totalChars } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { extractJson, asObject } from "../../lib/ai/json";
import { SCORE_ESSAY_SYSTEM } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";

export const scoreEssayRouter = Router();

const MAX_ESSAY_CHARS = 20_000;

const bodySchema = z.object({
  essay: z.string().min(1, "Paste your draft to get feedback").max(MAX_ESSAY_CHARS * 2),
  docType: z
    .enum(["sop", "personal_statement", "scholarship_essay", "motivation_letter", "cover_letter"])
    .default("sop"),
  target: z.string().max(255).optional(),
});

/**
 * Essay scoring.
 *
 * Unlike the other strict-JSON features there is no canned fallback here, and
 * that is deliberate. A fabricated review would quote passages the user did not
 * write and score work the model never read — for a document they are about to
 * submit to a university. "We could not review this right now" is the only
 * honest failure, so this is the one AI endpoint that returns 503 rather than
 * degraded output.
 */
scoreEssayRouter.post("/", requireAuth, aiGuard("score-essay"), async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body);

    if (totalChars(body.essay, body.docType, body.target) > MAX_ESSAY_CHARS) {
      return tooLarge(res, MAX_ESSAY_CHARS);
    }

    const config = await getAiConfig();

    if (!aiConfigured) {
      return res.status(503).json({
        error: "Essay review is not available right now. Your draft has not been changed.",
        code: "ai/unavailable",
      });
    }

    try {
      const completion = await chatCompletion({
        model: config.ai_model,
        maxTokens: 2000,
        messages: [
          { role: "system", content: SCORE_ESSAY_SYSTEM },
          {
            role: "user",
            content:
              `Document type: ${body.docType}\nTarget: ${body.target ?? "unspecified"}\n\n` +
              `--- ESSAY START ---\n${body.essay}\n--- ESSAY END ---\n\n` +
              `Return strict JSON per the schema.`,
          },
        ],
      });

      await recordUsage({
        userId: req.user!.sub,
        feature: "score-essay",
        model: config.ai_model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        responseTimeMs: completion.responseTimeMs,
      });

      const parsed = asObject(extractJson(completion.text));
      if (!parsed || typeof parsed.overall !== "number") {
        console.error("[ai/score-essay] non-JSON response:", completion.text.slice(0, 200));
        return res.status(503).json({
          error: "The review came back unreadable. Try again in a moment — your draft is safe.",
          code: "ai/bad-response",
        });
      }

      // The essay is the user's unpublished work. Nothing about this response
      // may sit in a shared cache.
      res.set("Cache-Control", "no-store");
      return res.json({
        ...parsed,
        usage: { input_tokens: completion.inputTokens, output_tokens: completion.outputTokens },
      });
    } catch (err) {
      await recordUsage({
        userId: req.user!.sub,
        feature: "score-essay",
        model: config.ai_model,
        error: (err as Error).message.slice(0, 500),
      });
      console.error("[ai/score-essay]", (err as Error).message);
      return res.status(503).json({
        error: "Essay review is temporarily unavailable. Your draft has not been changed.",
        code: "ai/unavailable",
      });
    }
  } catch (err) {
    next(err);
  }
});
