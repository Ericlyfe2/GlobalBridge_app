import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiGuard } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { extractJson, asObject } from "../../lib/ai/json";
import { READINESS_SYSTEM } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";
import {
  PILLARS,
  PILLAR_LABEL,
  autoNote,
  normalizePillars,
  readinessFallback,
  type ReadinessAction,
  type PillarOut,
} from "../../lib/ai/fallbacks";

export const readinessRouter = Router();

const bodySchema = z.object({
  pillars: z
    .object({
      documents: z.coerce.number().min(0).max(100).optional(),
      finances: z.coerce.number().min(0).max(100).optional(),
      housing: z.coerce.number().min(0).max(100).optional(),
      job: z.coerce.number().min(0).max(100).optional(),
      community: z.coerce.number().min(0).max(100).optional(),
    })
    .optional(),
  destination: z.string().max(100).optional(),
  purpose: z.string().max(100).optional(),
});

readinessRouter.post("/", requireAuth, aiGuard("readiness"), async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body ?? {});
    const scores = normalizePillars(body.pillars);

    // The overall score is arithmetic over the user's own self-report, so it is
    // computed here and never asked of the model. A model that rounds
    // differently on two requests would make the headline number flicker for
    // no reason.
    const overall = Math.round(PILLARS.reduce((s, k) => s + scores[k], 0) / PILLARS.length);

    const config = await getAiConfig();
    if (!aiConfigured) return res.json(readinessFallback(scores, overall));

    try {
      const completion = await chatCompletion({
        model: config.ai_model,
        maxTokens: 900,
        messages: [
          { role: "system", content: READINESS_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              pillars: scores,
              destination: body.destination ?? null,
              purpose: body.purpose ?? null,
            }),
          },
        ],
      });

      await recordUsage({
        userId: req.user!.sub,
        feature: "readiness",
        model: config.ai_model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        responseTimeMs: completion.responseTimeMs,
      });

      const parsed = asObject(extractJson(completion.text));
      const actions = parsed?.actions;
      if (!parsed || !Array.isArray(actions)) {
        console.error("[ai/readiness] non-JSON response:", completion.text.slice(0, 200));
        return res.json(readinessFallback(scores, overall));
      }

      const notes = (parsed.notes ?? {}) as Record<string, string>;
      const pillars: PillarOut[] = PILLARS.map((k) => ({
        key: k,
        label: PILLAR_LABEL[k],
        score: scores[k],
        note: typeof notes[k] === "string" && notes[k] ? notes[k] : autoNote(scores[k]),
      }));

      res.set("Cache-Control", "no-store");
      return res.json({
        overall,
        pillars,
        actions: (actions as ReadinessAction[]).slice(0, 3),
        usage: { input_tokens: completion.inputTokens, output_tokens: completion.outputTokens },
      });
    } catch (err) {
      await recordUsage({
        userId: req.user!.sub,
        feature: "readiness",
        model: config.ai_model,
        error: (err as Error).message.slice(0, 500),
      });
      console.error("[ai/readiness]", (err as Error).message);
      return res.json(readinessFallback(scores, overall));
    }
  } catch (err) {
    next(err);
  }
});
