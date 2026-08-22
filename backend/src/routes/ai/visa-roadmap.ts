import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiGuard, tooLarge, totalChars } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { extractJson } from "../../lib/ai/json";
import { VISA_ROADMAP_SYSTEM } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";
import { roadmapFallback, type Roadmap } from "../../lib/ai/fallbacks";

export const visaRoadmapRouter = Router();

const MAX_FIELD_CHARS = 400;

const bodySchema = z.object({
  origin: z.string().min(1).max(100),
  destination: z.string().min(1).max(100),
  purpose: z.enum(["study", "work", "settle"]).default("study"),
});

visaRoadmapRouter.post("/", requireAuth, aiGuard("visa-roadmap"), async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body);
    const origin = body.origin.trim();
    const destination = body.destination.trim();

    if (totalChars(origin, destination, body.purpose) > MAX_FIELD_CHARS) {
      return tooLarge(res, MAX_FIELD_CHARS);
    }

    const config = await getAiConfig();

    if (!aiConfigured) return res.json(roadmapFallback(origin, destination, body.purpose));

    try {
      const completion = await chatCompletion({
        model: config.ai_model,
        maxTokens: 1600,
        messages: [
          { role: "system", content: VISA_ROADMAP_SYSTEM },
          {
            role: "user",
            content: `Build a ${body.purpose} roadmap from ${origin} to ${destination}. Return strict JSON per the schema.`,
          },
        ],
      });

      await recordUsage({
        userId: req.user!.sub,
        feature: "visa-roadmap",
        model: config.ai_model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        responseTimeMs: completion.responseTimeMs,
      });

      const parsed = extractJson(completion.text) as Roadmap | null;
      if (!parsed || !Array.isArray(parsed.phases) || parsed.phases.length === 0) {
        console.error("[ai/visa-roadmap] non-JSON response:", completion.text.slice(0, 200));
        return res.json(roadmapFallback(origin, destination, body.purpose));
      }

      res.set("Cache-Control", "no-store");
      return res.json({
        ...parsed,
        // Costs and timeframes in a roadmap are estimates, and the client
        // renders a "verify on the official site" line from this rather than
        // relying on the model to have said so in every phase.
        estimates_only: true,
        usage: { input_tokens: completion.inputTokens, output_tokens: completion.outputTokens },
      });
    } catch (err) {
      await recordUsage({
        userId: req.user!.sub,
        feature: "visa-roadmap",
        model: config.ai_model,
        error: (err as Error).message.slice(0, 500),
      });
      console.error("[ai/visa-roadmap]", (err as Error).message);
      return res.json(roadmapFallback(origin, destination, body.purpose));
    }
  } catch (err) {
    next(err);
  }
});
