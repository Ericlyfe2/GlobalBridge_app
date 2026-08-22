/**
 * What each feature returns when the model cannot be reached.
 *
 * ── The honesty rule these all obey ───────────────────────────────────────
 * A fallback must never be mistakeable for a real analysis. Every one of these
 * either carries an explicit flag the client renders as a degraded state, or —
 * in Scam Shield's case — refuses to return the reassuring answer.
 *
 * That last point is the one that matters most. A safety tool that fails
 * *open* is worse than one that is switched off: "no scam signals found"
 * because the model was unreachable reads to a user exactly like "this listing
 * is safe", and they wire the deposit. So Scam Shield's fallback is a real
 * heuristic scan, and when it finds nothing it still lands in the cautious
 * band rather than declaring the message clean.
 */

// ─────────────────────────────────────────────────────────── scam shield ──

export type ScamSeverity = "low" | "med" | "high";
export type ScamFlag = { phrase: string; category: string; why: string; severity: ScamSeverity };
export type ScamVerdict = "Likely safe" | "Be cautious" | "High scam risk";
export type ScamResult = {
  score: number;
  verdict: ScamVerdict;
  summary: string;
  flags: ScamFlag[];
  advice: string[];
};

export function verdictFor(score: number): ScamVerdict {
  return score <= 33 ? "Likely safe" : score <= 66 ? "Be cautious" : "High scam risk";
}

export function defaultAdvice(score: number): string[] {
  if (score > 66) {
    return [
      "Do not send any money or personal documents.",
      "Insist on an in-person or video viewing before paying anything.",
      "Report this listing so we can warn other students.",
    ];
  }
  if (score > 33) {
    return [
      "Verify the person's identity and the address independently.",
      "Never pay a deposit before seeing a signed agreement.",
    ];
  }
  return ["Looks reasonable, but still verify the address and use traceable payment methods."];
}

/** Keep the verdict consistent with the score even if the model drifts from its own bands. */
export function normalizeScam(r: ScamResult): ScamResult {
  const score = Math.max(0, Math.min(100, Math.round(r.score)));
  return {
    score,
    verdict: verdictFor(score),
    summary: r.summary ?? "",
    flags: Array.isArray(r.flags) ? r.flags.slice(0, 12) : [],
    advice:
      Array.isArray(r.advice) && r.advice.length ? r.advice.slice(0, 4) : defaultAdvice(score),
  };
}

const SCAM_SIGNALS: { re: RegExp; category: string; why: string; severity: ScamSeverity }[] = [
  {
    re: /western union|moneygram|gift card|bitcoin|crypto|wire (the )?(money|deposit|funds)/i,
    category: "Off-platform payment",
    why: "Untraceable payment methods are the single most common sign of a rental or job scam.",
    severity: "high",
  },
  {
    re: /(no|without) (viewing|inspection|visit)|can'?t (show|view)|keys? will be (mailed|sent|couriered)/i,
    category: "No viewing",
    why: "Legitimate landlords let you view a property before you pay.",
    severity: "high",
  },
  {
    re: /(deposit|first month|payment).{0,30}(before|prior|to secure|to reserve|upfront)/i,
    category: "Upfront payment",
    why: "Being pushed to pay before signing anything is a classic scam pattern.",
    severity: "high",
  },
  {
    re: /processing fee|application fee|visa fee|training fee|background[- ]check fee|registration fee/i,
    category: "Upfront fee",
    why: "Real employers and scholarships do not charge you a fee to apply.",
    severity: "high",
  },
  {
    re: /(act|reply|pay|respond) (now|today|immediately|fast)|offer expires|many (people|others) (are )?interested|limited (time|slots)/i,
    category: "Urgency",
    why: "Pressure to act fast is designed to stop you checking the offer properly.",
    severity: "med",
  },
  {
    re: /(send|share|provide|confirm).{0,30}(passport|visa|bank (details|login)|ssn|social security|card number)/i,
    category: "Sensitive data request",
    why: "You should never share passport, visa, or bank credentials to 'confirm eligibility'.",
    severity: "high",
  },
  {
    re: /i(?:'m| am) (currently )?(abroad|overseas|out of the country|on a mission|missionary)/i,
    category: "Absent landlord",
    why: '"I am abroad so I cannot show it" is a very common fake-landlord script.',
    severity: "med",
  },
  {
    re: /guaranteed (job|income|visa|approval)|earn \$?\d{3,}\s*(\/|per )?(day|week)/i,
    category: "Too good to be true",
    why: "Guaranteed money or approvals with little effort are almost always fake.",
    severity: "med",
  },
];

/**
 * Heuristic scan used when the model is unavailable.
 *
 * Note what happens when it finds nothing: the score floors at 40, not 0. A
 * clean heuristic pass is not evidence of safety — it is evidence that eight
 * regexes did not match — and this tool's failure mode has to be caution.
 */
export function scamFallback(text: string): ScamResult & { degraded: true } {
  const flags: ScamFlag[] = [];

  for (const signal of SCAM_SIGNALS) {
    const m = text.match(signal.re);
    if (m) {
      flags.push({
        phrase: m[0],
        category: signal.category,
        why: signal.why,
        severity: signal.severity,
      });
    }
  }

  const weight = { low: 8, med: 18, high: 30 } as const;
  let score = flags.reduce((sum, f) => sum + weight[f.severity], 0);
  const highs = flags.filter((f) => f.severity === "high").length;
  if (highs >= 2) score += 10;

  // The floor. Never report "Likely safe" from a degraded scan.
  score = Math.max(40, Math.min(100, score));

  const summary =
    score > 66
      ? "Multiple strong scam signals detected — treat this as fraudulent until proven otherwise."
      : flags.length
        ? "Our full checker is unavailable, but some warning signs are present. Verify everything before paying or sharing documents."
        : "Our full checker is unavailable right now, so this has only had a basic scan. Treat it with normal caution and verify before paying.";

  return {
    score,
    verdict: verdictFor(score),
    summary,
    flags,
    advice: defaultAdvice(score),
    degraded: true,
  };
}

/** Scam Shield turned off by an admin. Cautious middle band, never a fake specific analysis. */
export function scamDisabled(): ScamResult & { disabled: true } {
  return {
    score: 50,
    verdict: "Be cautious",
    summary: "Scam Shield has been turned off by an admin — we cannot analyse this right now.",
    flags: [],
    advice: ["Use your own judgement and the safety tips on the Scam Alerts page."],
    disabled: true,
  };
}

// ──────────────────────────────────────────────────────── document check ──

export type DocSeverity = "ok" | "warn" | "fail";
export type DocFinding = { id: string; label: string; detail: string; severity: DocSeverity };
export type DocCheckResult = {
  score: number;
  label: "Looks great" | "Review warnings" | "Needs fixes";
  summary: string;
  findings: DocFinding[];
};

/**
 * The degraded document check is a checklist, not a verdict.
 *
 * The live feature never sees the file either — it reasons from the declared
 * type and metadata — so the honest fallback is the standard checklist for that
 * document type with every item marked "warn": these are things to verify, and
 * we have not verified any of them.
 */
const DOC_CHECKLISTS: Record<string, [string, string][]> = {
  passport: [
    ["Expiry more than 6 months away", "Most embassies reject a passport expiring within 6 months of travel."],
    ["Name format matches your application", "A mismatch in name order between passport and form is a common rejection reason."],
    ["Bio page photo is clear and unglared", "Reshoot in even lighting if there is glare across the page."],
    ["Machine-readable zone is legible", "The two lines at the bottom must be fully readable, uncropped."],
    ["No damage to the bio page", "Tears, water damage, or a detached laminate can invalidate the document."],
  ],
  bank_statement: [
    ["Account holder name matches your application", "The name on the statement must match your passport exactly."],
    ["Dated within the last 3 months", "Most embassies reject statements older than 3 months."],
    ["Currency is stated explicitly", "Amounts without a currency code get queried or rejected."],
    ["On official bank letterhead", "Print on letterhead or attach a bank confirmation letter."],
    ["Shows the required seasoning period", "Many visas require funds to have been held for a minimum number of days."],
  ],
  transcript: [
    ["Official seal and registrar signature present", "An unsealed transcript is usually treated as unofficial."],
    ["Grading scale explained on the document", "Without the scale, your GPA cannot be interpreted."],
    ["Certified translation attached if not in English", "The translation must itself be certified, not just accurate."],
    ["All semesters included", "Partial transcripts get returned for completion."],
  ],
  acceptance_letter: [
    ["Institution code listed (DLI / SEVP as applicable)", "Required for study permit and F-1 applications."],
    ["Program name and start date stated", "Both are checked against your visa application."],
    ["Conditional vs unconditional is clear", "Outstanding conditions weaken the application — resolve them first."],
    ["Signed by the institution", "An unsigned offer letter is not accepted as proof of admission."],
  ],
  study_permit: [
    ["Valid more than 6 months past arrival", "Some carriers refuse boarding otherwise."],
    ["Work-hour conditions readable", "You need to know your limit before you accept any job."],
    ["Biometrics confirmation retained", "Keep the VAC receipt with the permit."],
  ],
  national_id: [
    ["Both sides captured", "Some embassies require front and back."],
    ["Expiry date still valid", "Check it covers your whole application window."],
    ["Photo and text fully legible", "Reshoot flat, in even light, with no crop."],
  ],
};

export function docCheckFallback(docType: string): DocCheckResult & { degraded: true } {
  const checklist = DOC_CHECKLISTS[docType] ?? DOC_CHECKLISTS.passport;

  return {
    score: 0,
    label: "Review warnings",
    summary:
      "Our document checker is unavailable right now, so nothing here has been checked. " +
      "This is the standard checklist for this document — verify each item yourself.",
    findings: checklist.map(([label, detail], i) => ({
      id: `${docType}-${i}`,
      label,
      detail,
      // Every item is "warn": unverified, not passed. Marking any of these "ok"
      // would tell the user a check succeeded when none of them ran.
      severity: "warn" as const,
    })),
    degraded: true,
  };
}

export function docCheckDisabled(): DocCheckResult & { disabled: true } {
  return {
    score: 0,
    label: "Needs fixes",
    summary: "The document checker has been turned off by an admin.",
    findings: [],
    disabled: true,
  };
}

// ───────────────────────────────────────────────────────── visa roadmap ──

export type Phase = {
  id: string;
  title: string;
  timeframe: string;
  cost: string;
  documents: string[];
  tip: string;
};
export type Roadmap = { title: string; totalWeeks: number; phases: Phase[] };

const STUDY_PHASES: Phase[] = [
  { id: "choose", title: "Choose program & get admission", timeframe: "Weeks 1–8", cost: "$50–$150/app", documents: ["Transcripts", "Statement of purpose", "Reference letters"], tip: "Apply to a safety, a match, and a reach school." },
  { id: "offer", title: "Accept offer & pay deposit", timeframe: "Weeks 8–10", cost: "$200–$2,000", documents: ["Acceptance letter", "Tuition deposit receipt"], tip: "Keep the official acceptance letter — the visa application needs it." },
  { id: "funds", title: "Prove funds & finances", timeframe: "Weeks 10–12", cost: "$0", documents: ["Bank statements", "Scholarship / sponsor letter"], tip: "Funds usually must sit in the account for a minimum period before they count." },
  { id: "apply", title: "Submit study-visa application", timeframe: "Weeks 12–14", cost: "$150–$500", documents: ["Passport", "Acceptance letter", "Proof of funds", "Photos"], tip: "Double-check photo specifications — wrong sizing is a top rejection reason." },
  { id: "bio", title: "Biometrics & interview", timeframe: "Weeks 14–18", cost: "$85", documents: ["Appointment letter", "Application summary"], tip: "Rehearse your study plan; interviews test genuine intent." },
  { id: "travel", title: "Travel & arrival setup", timeframe: "Weeks 18–20", cost: "$500–$2,000", documents: ["Visa", "Accommodation proof", "Enrolment confirmation"], tip: "Sort housing before you fly, and check every listing with Scam Shield." },
];

const WORK_PHASES: Phase[] = [
  { id: "offer", title: "Secure a job offer & sponsorship", timeframe: "Weeks 1–6", cost: "Varies", documents: ["CV / resume", "Reference letters", "Job offer letter"], tip: "Target employers with a proven visa-sponsorship track record." },
  { id: "eligib", title: "Confirm visa eligibility", timeframe: "Weeks 6–8", cost: "$0", documents: ["Passport", "Qualification certificates"], tip: "Check the destination's skilled-occupation list before anything else." },
  { id: "docs", title: "Gather & certify documents", timeframe: "Weeks 8–11", cost: "$100–$400", documents: ["Proof of funds", "Police clearance", "Medical exam"], tip: "Start police-clearance requests early — they can take weeks." },
  { id: "apply", title: "Submit work-visa application", timeframe: "Weeks 11–13", cost: "$200–$1,500", documents: ["Sponsorship certificate", "Biometrics"], tip: "Save a PDF copy of every document you submit." },
  { id: "decision", title: "Decision & biometrics", timeframe: "Weeks 13–18", cost: "$85", documents: ["Appointment confirmation"], tip: "Book your biometrics appointment the moment it is offered." },
  { id: "arrive", title: "Travel & settle in", timeframe: "Weeks 18–20", cost: "$500–$2,000", documents: ["Visa vignette", "Accommodation proof"], tip: "Use the Toolkit to set up banking and a SIM on arrival." },
];

const SETTLE_PHASES: Phase[] = [
  { id: "assess", title: "Assess residency pathway", timeframe: "Weeks 1–4", cost: "$0", documents: ["Passport", "Current visa"], tip: "Points-based routes reward language scores and work history." },
  { id: "lang", title: "Language & qualification proof", timeframe: "Weeks 4–10", cost: "$200–$350", documents: ["Language test result", "Credential assessment"], tip: "Book the language test early; slots fill up fast." },
  { id: "express", title: "Enter the immigration pool", timeframe: "Weeks 10–12", cost: "$0", documents: ["Profile submission"], tip: "Keep your profile updated — cut-off scores change with each draw." },
  { id: "invite", title: "Receive invitation & apply", timeframe: "Weeks 12–24", cost: "$800–$1,500", documents: ["Proof of funds", "Police clearance", "Medical exam"], tip: "Respond within the deadline; invitations expire." },
  { id: "land", title: "Confirm residency & land", timeframe: "Weeks 24–30", cost: "$500+", documents: ["Confirmation of residency", "Landing forms"], tip: "Register for healthcare and a tax number in your first week." },
];

export function roadmapFallback(
  origin: string,
  destination: string,
  purpose: string,
): Roadmap & { degraded: true } {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const label = purpose === "work" ? "Work" : purpose === "settle" ? "Settlement" : "Study";
  const phases = purpose === "work" ? WORK_PHASES : purpose === "settle" ? SETTLE_PHASES : STUDY_PHASES;

  return {
    title: `${label} visa roadmap: ${cap(origin)} → ${cap(destination)}`,
    totalWeeks: purpose === "settle" ? 30 : 20,
    phases,
    // The client shows a "generic roadmap, not tailored to your countries"
    // banner from this. Costs here are illustrative ranges, not the
    // destination's real fees, and presenting them as tailored would be
    // inventing figures — the one thing the safety contract forbids outright.
    degraded: true,
  };
}

// ────────────────────────────────────────────────────────────── readiness ──

export const PILLARS = ["documents", "finances", "housing", "job", "community"] as const;
export type PillarKey = (typeof PILLARS)[number];

export const PILLAR_LABEL: Record<PillarKey, string> = {
  documents: "Documents",
  finances: "Finances",
  housing: "Housing",
  job: "Job / income",
  community: "Community",
};

export type ReadinessAction = { title: string; detail: string; pillar: PillarKey };
export type PillarOut = { key: PillarKey; label: string; score: number; note: string };
export type ReadinessResult = { overall: number; pillars: PillarOut[]; actions: ReadinessAction[] };

export function normalizePillars(
  input: Partial<Record<PillarKey, number>> | undefined,
): Record<PillarKey, number> {
  const out = {} as Record<PillarKey, number>;
  for (const k of PILLARS) {
    const v = Number(input?.[k]);
    out[k] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
  }
  return out;
}

export function autoNote(score: number): string {
  if (score >= 80) return "On track";
  if (score >= 50) return "Making progress";
  if (score >= 25) return "Needs attention";
  return "Not started";
}

const ACTION_LIBRARY: Record<PillarKey, ReadinessAction> = {
  documents: {
    title: "Run your documents through the Document Checker",
    detail: "Catch rejection triggers — expiry, name mismatch, missing seals — before you submit.",
    pillar: "documents",
  },
  finances: {
    title: "Build a proof-of-funds statement",
    detail: "Most visas want funds seasoned for a set period, so start the paper trail now.",
    pillar: "finances",
  },
  housing: {
    title: "Shortlist three verified housing listings",
    detail: "Use verified listings and check each one with Scam Shield before paying anything.",
    pillar: "housing",
  },
  job: {
    title: "Check the visa sponsorship listings",
    detail: "Targeting employers who already sponsor visas shortens the job hunt considerably.",
    pillar: "job",
  },
  community: {
    title: "Connect with a mentor in your destination",
    detail: "A mentor who has made the same move de-risks every decision that follows.",
    pillar: "community",
  },
};

/**
 * The readiness fallback is not degraded in the same way as the others: the
 * scores are the user's own self-report and the arithmetic is ours, so the
 * numbers are exactly as true as they were going to be. Only the tailored
 * coaching text is missing, and the lowest-pillar-first rule reproduces most of
 * its value.
 */
export function readinessFallback(
  scores: Record<PillarKey, number>,
  overall: number,
): ReadinessResult {
  return {
    overall,
    pillars: PILLARS.map((k) => ({
      key: k,
      label: PILLAR_LABEL[k],
      score: scores[k],
      note: autoNote(scores[k]),
    })),
    actions: [...PILLARS].sort((a, b) => scores[a] - scores[b]).slice(0, 3).map((k) => ACTION_LIBRARY[k]),
  };
}
