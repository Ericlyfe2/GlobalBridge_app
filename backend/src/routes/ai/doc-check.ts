import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiGuard, tooLarge, totalChars } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { extractJson, asObject } from "../../lib/ai/json";
import { DOC_CHECK_SYSTEM } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";
import { docCheckFallback, docCheckDisabled } from "../../lib/ai/fallbacks";

export const docCheckRouter = Router();

const MAX_DOC_CHARS = 30_000;

const DOC_TYPES = [
  "passport",
  "national_id",
  "bank_statement",
  "transcript",
  "acceptance_letter",
  "study_permit",
  "insurance",
  "other",
] as const;

const bodySchema = z.object({
  docType: z.enum(DOC_TYPES),
  fileName: z.string().max(255).optional(),
  fileSize: z.number().int().min(0).max(100_000_000).optional(),
  notes: z.string().max(MAX_DOC_CHARS).optional(),
  meta: z
    .object({
      name: z.string().max(255).optional(),
      expiry: z.string().max(64).optional(),
      country: z.string().max(100).optional(),
    })
    .optional(),
});

/**
 * Document Checker.
 *
 * ── What this endpoint does not do ────────────────────────────────────────
 * It does not read the document. It never has. The user sends a declared type,
 * some metadata, and optional notes; the model reasons about what governments
 * commonly reject for that document type. The system prompt is explicit about
 * this because a model asked about a passport will otherwise happily narrate
 * what it "sees" on the bio page.
 *
 * That constraint is why no file is accepted here and no file content is
 * logged: the value is the checklist, and pretending otherwise would be
 * fabricating observations about someone's identity documents.
 */
docCheckRouter.post("/", requireAuth, aiGuard("doc-check"), async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body);

    const size = totalChars(
      body.docType,
      body.fileName,
      body.notes,
      body.meta?.name,
      body.meta?.expiry,
      body.meta?.country,
    );
    if (size > MAX_DOC_CHARS) return tooLarge(res, MAX_DOC_CHARS);

    const config = await getAiConfig();

    if (!config.ai_doc_check_enabled) return res.json(docCheckDisabled());
    if (!aiConfigured) return res.json(docCheckFallback(body.docType));

    // Filenames can carry a legal name; metadata carries expiry dates. Both go
    // to the model because they are the input, and neither is logged here.
    const payload = JSON.stringify(
      {
        docType: body.docType,
        fileName: body.fileName ?? null,
        fileSizeKb: body.fileSize ? Math.round(body.fileSize / 1024) : null,
        notes: body.notes ?? "",
        meta: body.meta ?? {},
      },
      null,
      2,
    );

    try {
      const completion = await chatCompletion({
        model: config.ai_model,
        maxTokens: 1500,
        messages: [
          { role: "system", content: DOC_CHECK_SYSTEM },
          {
            role: "user",
            content: `Run validity checks for this document. Return strict JSON per the schema.\n\n${payload}`,
          },
        ],
      });

      await recordUsage({
        userId: req.user!.sub,
        feature: "doc-check",
        model: config.ai_model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        responseTimeMs: completion.responseTimeMs,
      });

      const parsed = asObject(extractJson(completion.text));
      if (!parsed || !Array.isArray(parsed.findings)) {
        console.error("[ai/doc-check] non-JSON response:", completion.text.slice(0, 200));
        return res.json(docCheckFallback(body.docType));
      }

      // Documents are sensitive; nothing about them is cacheable.
      res.set("Cache-Control", "no-store");
      return res.json({
        ...parsed,
        usage: { input_tokens: completion.inputTokens, output_tokens: completion.outputTokens },
      });
    } catch (err) {
      await recordUsage({
        userId: req.user!.sub,
        feature: "doc-check",
        model: config.ai_model,
        error: (err as Error).message.slice(0, 500),
      });
      console.error("[ai/doc-check]", (err as Error).message);
      res.set("Cache-Control", "no-store");
      return res.json(docCheckFallback(body.docType));
    }
  } catch (err) {
    next(err);
  }
});
