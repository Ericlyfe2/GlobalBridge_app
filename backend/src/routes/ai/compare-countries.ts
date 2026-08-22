import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiGuard } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { extractJson, asObject } from "../../lib/ai/json";
import { COMPARE_COUNTRIES_SYSTEM, LANG_NAMES } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";
import { normalizeLocale } from "../../lib/i18n";

export const compareCountriesRouter = Router();

/**
 * ISO-2 to display name.
 *
 * Kept as a list rather than pulled from Intl.DisplayNames because the model is
 * given the name, and an unfamiliar or ambiguous rendering ("Côte d'Ivoire" vs
 * "Ivory Coast") changes what it retrieves from its own weights. A fixed list
 * makes the prompt reproducible.
 */
const COUNTRY_NAMES: Record<string, string> = {
  gh: "Ghana", ng: "Nigeria", ke: "Kenya", za: "South Africa",
  rw: "Rwanda", ug: "Uganda", tz: "Tanzania", et: "Ethiopia",
  eg: "Egypt", ma: "Morocco", sn: "Senegal", ci: "Ivory Coast",
  in: "India", pk: "Pakistan", bd: "Bangladesh", lk: "Sri Lanka",
  vn: "Vietnam", ph: "Philippines", id: "Indonesia", my: "Malaysia",
  ca: "Canada", us: "United States", gb: "United Kingdom",
  de: "Germany", fr: "France", nl: "Netherlands", se: "Sweden",
  no: "Norway", dk: "Denmark", fi: "Finland", ie: "Ireland",
  be: "Belgium", ch: "Switzerland", at: "Austria", it: "Italy",
  es: "Spain", pt: "Portugal", au: "Australia", nz: "New Zealand",
  jp: "Japan", kr: "South Korea", cn: "China", sg: "Singapore",
  ae: "UAE", sa: "Saudi Arabia", qa: "Qatar", il: "Israel",
  br: "Brazil", mx: "Mexico", ar: "Argentina", cl: "Chile",
  tr: "Turkey", ru: "Russia", ua: "Ukraine", pl: "Poland",
  cz: "Czech Republic", hu: "Hungary", ro: "Romania", gr: "Greece",
};

const bodySchema = z.object({
  country1: z.string().min(2).max(2),
  country2: z.string().min(2).max(2),
  lang: z.string().max(10).optional(),
});

compareCountriesRouter.post(
  "/",
  requireAuth,
  aiGuard("compare-countries"),
  async (req, res, next) => {
    try {
      const body = bodySchema.parse(req.body);
      const code1 = body.country1.toLowerCase();
      const code2 = body.country2.toLowerCase();

      if (code1 === code2) {
        return res.status(400).json({
          error: "Pick two different countries to compare.",
          code: "compare/same-country",
        });
      }

      const name1 = COUNTRY_NAMES[code1];
      const name2 = COUNTRY_NAMES[code2];
      if (!name1 || !name2) {
        // Refusing an unknown code rather than passing it through: the model
        // would cheerfully invent a comparison for a two-letter string that is
        // not a country.
        return res.status(400).json({
          error: "We do not have comparison data for one of those countries yet.",
          code: "compare/unknown-country",
        });
      }

      const config = await getAiConfig();
      if (!aiConfigured) {
        return res.status(503).json({
          error: "Country comparison is not available right now.",
          code: "ai/unavailable",
        });
      }

      const locale = normalizeLocale(body.lang);
      const langInstruction =
        locale !== "en"
          ? `\n\nAll text fields (summary, verdict, category labels, and each country's text) MUST be written in ${LANG_NAMES[locale]}. Only ISO codes and numbers stay as they are.`
          : "";

      try {
        const completion = await chatCompletion({
          model: config.ai_model,
          maxTokens: 2048,
          messages: [
            { role: "system", content: COMPARE_COUNTRIES_SYSTEM + langInstruction },
            {
              role: "user",
              content: `Compare ${name1} (${code1}) vs ${name2} (${code2}) for an international student or immigrant.`,
            },
          ],
        });

        await recordUsage({
          userId: req.user!.sub,
          feature: "compare-countries",
          model: config.ai_model,
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
          responseTimeMs: completion.responseTimeMs,
        });

        const parsed = asObject(extractJson(completion.text));
        const categories = parsed?.categories;
        if (!parsed || !Array.isArray(categories) || categories.length === 0) {
          console.error("[ai/compare-countries] non-JSON response:", completion.text.slice(0, 200));
          return res.status(503).json({
            error: `Comparison for ${name1} vs ${name2} is temporarily unavailable. Please try again.`,
            code: "ai/bad-response",
          });
        }

        res.set("Cache-Control", "no-store");
        return res.json({
          ...parsed,
          country1Name: name1,
          country2Name: name2,
          country1Code: code1,
          country2Code: code2,
          estimates_only: true,
          usage: { input_tokens: completion.inputTokens, output_tokens: completion.outputTokens },
        });
      } catch (err) {
        await recordUsage({
          userId: req.user!.sub,
          feature: "compare-countries",
          model: config.ai_model,
          error: (err as Error).message.slice(0, 500),
        });
        console.error("[ai/compare-countries]", (err as Error).message);
        // The previous implementation returned the provider's error message in
        // the response body. That leaks internals to the client for no benefit.
        return res.status(503).json({
          error: `Comparison for ${name1} vs ${name2} is temporarily unavailable. Please try again.`,
          code: "ai/unavailable",
        });
      }
    } catch (err) {
      next(err);
    }
  },
);
