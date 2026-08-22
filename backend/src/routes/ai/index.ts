import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { todayQuota } from "../../lib/ai/usage";
import { getAiConfig } from "../../lib/ai/config";
import { aiConfigured } from "../../lib/ai/client";

import { chatRouter } from "./chat";
import { scamCheckRouter } from "./scam-check";
import { docCheckRouter } from "./doc-check";
import { visaRoadmapRouter } from "./visa-roadmap";
import { readinessRouter } from "./readiness";
import { scoreEssayRouter } from "./score-essay";
import { compareCountriesRouter } from "./compare-countries";
import { translateRouter } from "./translate";
import { conversationsRouter } from "./conversations";

/**
 * The AI surface, in one place.
 *
 * These eight features used to live in the web frontend's Next.js runtime and
 * reach back into this API over HTTP for auth, quota and persistence. There is
 * now exactly one implementation of each: one rate limiter, one usage ledger,
 * one set of prompts, one place the OpenAI key exists.
 *
 * The web frontend's route handlers become thin proxies to these paths — not a
 * second copy. Two copies is how a model identifier ends up correct in one
 * runtime and wrong in the other, with the wrong one failing silently into
 * canned output.
 */
export const aiRouter = Router();

aiRouter.use("/chat", chatRouter);
aiRouter.use("/scam-check", scamCheckRouter);
aiRouter.use("/doc-check", docCheckRouter);
aiRouter.use("/visa-roadmap", visaRoadmapRouter);
aiRouter.use("/readiness", readinessRouter);
aiRouter.use("/score-essay", scoreEssayRouter);
aiRouter.use("/compare-countries", compareCountriesRouter);
aiRouter.use("/translate", translateRouter);
aiRouter.use("/conversations", conversationsRouter);

/**
 * What the caller has spent today, and against what ceiling.
 *
 * Exposed to the user rather than kept as an internal counter: being cut off
 * mid-task with no warning and no way to see why is a bad experience, and the
 * app shows a budget indicator from this before that happens.
 */
aiRouter.get("/usage/today", requireAuth, async (req, res, next) => {
  try {
    const quota = await todayQuota(req.user!.sub);
    res.set("Cache-Control", "no-store");
    res.json(quota);
  } catch (err) {
    next(err);
  }
});

/**
 * Which AI features are actually usable right now.
 *
 * The app disables a tool's entry point from this rather than letting the user
 * open a screen, type a document into it, and only then discover the feature is
 * switched off. The honesty rule applies to the navigation, not just the
 * response body.
 */
aiRouter.get("/status", requireAuth, async (_req, res, next) => {
  try {
    const config = await getAiConfig();
    res.set("Cache-Control", "no-store");
    res.json({
      configured: aiConfigured,
      model: config.ai_model,
      features: {
        chat: aiConfigured && config.ai_chat_enabled,
        "scam-check": config.ai_scam_detection_enabled,
        "doc-check": aiConfigured && config.ai_doc_check_enabled,
        translate: aiConfigured && config.ai_translation_enabled,
        // No admin toggle of their own; they follow whether AI is configured.
        "visa-roadmap": true,
        readiness: true,
        "score-essay": aiConfigured,
        "compare-countries": aiConfigured,
      },
      // scam-check and visa-roadmap stay true above because they answer usefully
      // without the model — a heuristic scan and a generic roadmap. The client
      // shows those as available-but-degraded rather than hiding them.
      degraded: !aiConfigured,
    });
  } catch (err) {
    next(err);
  }
});
