import { describe, it, expect } from "vitest";
import { extractJson, asObject } from "../lib/ai/json";
import { costUsd, priceFor, FALLBACK_PRICE, nextResetAt } from "../lib/ai/pricing";
import {
  scamFallback,
  scamDisabled,
  normalizeScam,
  verdictFor,
  docCheckFallback,
  docCheckDisabled,
  roadmapFallback,
  readinessFallback,
  normalizePillars,
  PILLARS,
} from "../lib/ai/fallbacks";

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"score":42}')).toEqual({ score: 42 });
  });

  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"score":42}\n```')).toEqual({ score: 42 });
    expect(extractJson('```\n{"score":42}\n```')).toEqual({ score: 42 });
  });

  it("recovers JSON preceded by prose", () => {
    // Models do this constantly despite being told not to. Treating it as a
    // failure would drop a perfectly good answer into the fallback.
    expect(extractJson('Here is the analysis:\n{"score":42}')).toEqual({ score: 42 });
  });

  it("keeps nested objects whole", () => {
    // A lazy regex stops at the first inner brace and yields a truncated
    // fragment that parses to the wrong shape — worse than failing.
    const nested = '{"a":{"b":{"c":1}},"d":2}';
    expect(extractJson(`noise ${nested} noise`)).toEqual({ a: { b: { c: 1 } }, d: 2 });
  });

  it("recovers a top-level array, which translate returns", () => {
    expect(extractJson('```json\n["un","deux"]\n```')).toEqual(["un", "deux"]);
  });

  it("returns null when there is no JSON at all", () => {
    expect(extractJson("I cannot help with that.")).toBeNull();
    expect(extractJson("")).toBeNull();
  });

  it("returns null for malformed JSON rather than a partial object", () => {
    expect(extractJson('{"score": }')).toBeNull();
  });
});

describe("asObject", () => {
  it("accepts a plain object and rejects everything else", () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expect(asObject([1, 2])).toBeNull();
    expect(asObject(null)).toBeNull();
    expect(asObject("x")).toBeNull();
  });
});

describe("pricing", () => {
  it("prices a known model from the table", () => {
    // 1M input + 1M output on gpt-4o-mini
    expect(costUsd("gpt-4o-mini", 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });

  it("charges an unknown model at the punitive fallback", () => {
    // An unpriced model must never be free: that turns "admin picked a model we
    // haven't priced" into an unmetered spend hole.
    expect(priceFor("some-new-model")).toBe(FALLBACK_PRICE);
    expect(priceFor(null)).toBe(FALLBACK_PRICE);
    expect(costUsd("some-new-model", 1_000_000, 0)).toBe(10);
  });

  it("costs nothing for zero tokens", () => {
    expect(costUsd("gpt-4o", 0, 0)).toBe(0);
  });

  it("resets at the next UTC midnight", () => {
    const reset = nextResetAt(new Date("2026-08-22T13:45:00Z"));
    expect(reset).toBe("2026-08-23T00:00:00.000Z");
  });
});

describe("scam shield fallback", () => {
  it("never reports a clean message as safe when the model was unavailable", () => {
    // The single most important assertion in this file. A safety tool that
    // fails open reads to the user as "this listing is safe" and they wire the
    // deposit. No signals found means eight regexes did not match — not safety.
    const result = scamFallback("Hi, the flat is available from September. Happy to arrange a viewing.");
    expect(result.verdict).not.toBe("Likely safe");
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.degraded).toBe(true);
    expect(result.summary).toMatch(/unavailable/i);
  });

  it("still catches the classic signals without the model", () => {
    const result = scamFallback(
      "No viewing needed, I am currently abroad. Send the deposit by Western Union today to secure it.",
    );
    expect(result.verdict).toBe("High scam risk");
    expect(result.score).toBeGreaterThan(66);
    expect(result.flags.length).toBeGreaterThanOrEqual(3);
  });

  it("quotes verbatim so the client can highlight the phrase", () => {
    const text = "Please pay the deposit before viewing.";
    const result = scamFallback(text);
    for (const flag of result.flags) {
      expect(text).toContain(flag.phrase);
    }
  });

  it("returns the cautious band when an admin turned it off", () => {
    const off = scamDisabled();
    expect(off.verdict).toBe("Be cautious");
    expect(off.disabled).toBe(true);
    expect(off.flags).toEqual([]);
    // Explicitly says why, rather than looking like a real analysis that found
    // nothing.
    expect(off.summary).toMatch(/turned off/i);
  });

  it("always gives at least one piece of advice", () => {
    for (const text of ["", "normal listing", "wire the money now"]) {
      expect(scamFallback(text).advice.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeScam", () => {
  it("forces the verdict to match the score when the model drifts", () => {
    const drifted = normalizeScam({
      score: 90,
      verdict: "Likely safe",
      summary: "",
      flags: [],
      advice: [],
    });
    expect(drifted.verdict).toBe("High scam risk");
  });

  it("clamps an out-of-range score", () => {
    expect(normalizeScam({ score: 150, verdict: "Likely safe", summary: "", flags: [], advice: [] }).score).toBe(100);
    expect(normalizeScam({ score: -20, verdict: "High scam risk", summary: "", flags: [], advice: [] }).score).toBe(0);
  });

  it("uses the band boundaries the prompt specifies", () => {
    expect(verdictFor(33)).toBe("Likely safe");
    expect(verdictFor(34)).toBe("Be cautious");
    expect(verdictFor(66)).toBe("Be cautious");
    expect(verdictFor(67)).toBe("High scam risk");
  });

  it("substitutes advice when the model returned none", () => {
    const r = normalizeScam({ score: 80, verdict: "High scam risk", summary: "", flags: [], advice: [] });
    expect(r.advice.length).toBeGreaterThan(0);
  });
});

describe("document check fallback", () => {
  it("marks every item unverified rather than passed", () => {
    // The live feature never reads the file either — but a fallback claiming
    // "MRZ readable" would be fabricating an observation about someone's
    // passport. Every finding is a check the user must run.
    const result = docCheckFallback("passport");
    expect(result.degraded).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.severity === "warn")).toBe(true);
    expect(result.summary).toMatch(/nothing here has been checked/i);
  });

  it("gives the checklist for the requested document type", () => {
    const bank = docCheckFallback("bank_statement");
    expect(bank.findings.some((f) => /3 months/i.test(f.label))).toBe(true);
  });

  it("falls back to a known checklist for an unmapped type", () => {
    expect(docCheckFallback("insurance").findings.length).toBeGreaterThan(0);
  });

  it("says so plainly when an admin turned it off", () => {
    const off = docCheckDisabled();
    expect(off.disabled).toBe(true);
    expect(off.findings).toEqual([]);
  });
});

describe("roadmap fallback", () => {
  it("flags itself as generic", () => {
    // The costs in here are illustrative ranges, not the destination's real
    // fees. Presenting them as tailored would be inventing figures.
    const r = roadmapFallback("ghana", "canada", "study");
    expect(r.degraded).toBe(true);
    expect(r.phases.length).toBeGreaterThan(0);
    expect(r.title).toContain("Ghana");
    expect(r.title).toContain("Canada");
  });

  it("varies by purpose", () => {
    const study = roadmapFallback("gh", "ca", "study");
    const work = roadmapFallback("gh", "ca", "work");
    const settle = roadmapFallback("gh", "ca", "settle");
    expect(study.phases[0].id).not.toBe(work.phases[0].id);
    expect(settle.totalWeeks).toBe(30);
  });
});

describe("readiness", () => {
  it("clamps and defaults self-reported scores", () => {
    const scores = normalizePillars({ documents: 150, finances: -5, housing: 42 });
    expect(scores.documents).toBe(100);
    expect(scores.finances).toBe(0);
    expect(scores.housing).toBe(42);
    // Unreported pillars are 0, not undefined — the average has to be defined.
    expect(scores.job).toBe(0);
  });

  it("targets the lowest pillars first", () => {
    const scores = normalizePillars({
      documents: 90,
      finances: 10,
      housing: 20,
      job: 95,
      community: 30,
    });
    const result = readinessFallback(scores, 49);
    expect(result.actions.map((a) => a.pillar)).toEqual(["finances", "housing", "community"]);
  });

  it("returns every pillar with a status note", () => {
    const result = readinessFallback(normalizePillars({}), 0);
    expect(result.pillars).toHaveLength(PILLARS.length);
    expect(result.pillars.every((p) => p.note.length > 0)).toBe(true);
  });
});
