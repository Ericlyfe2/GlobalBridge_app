import "./setup-env";
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Route-level behaviour of the AI surface, with no provider and no database.
 *
 * These cover the paths that are hardest to check by hand and easiest to
 * regress: what happens when the model is unreachable, when an admin has
 * switched a feature off, and when an account is over budget.
 */

const verifyIdToken = vi.fn();

vi.mock("../lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken },
  adminMessaging: { send: vi.fn() },
}));

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const queryMock = vi.fn<QueryFn>(async () => []);
const queryOneMock = vi.fn<QueryOneFn>(async () => null);

vi.mock("../db", () => ({
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
  redis: null,
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
  queryOne: (sql: string, params?: unknown[]) => queryOneMock(sql, params),
  withTransaction: vi.fn(),
}));

const AUTH = "Bearer test-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";

let app: Express;

beforeAll(async () => {
  const { createApp } = await import("../app");
  app = createApp();
});

/** platform_settings rows for one call to getAiConfig. */
let settingsRows: { key: string; value: unknown }[] = [];
/** Rows the ai_usage_log aggregate returns, driving the spend ceiling. */
let usageRows: unknown[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  settingsRows = [];
  usageRows = [];

  verifyIdToken.mockResolvedValue({ uid: "firebase-uid", email: "student@example.com" });

  queryMock.mockImplementation(async (sql) => {
    if (sql.includes("FROM platform_settings")) return settingsRows;
    if (sql.includes("FROM ai_usage_log")) return usageRows;
    return [];
  });
  queryOneMock.mockImplementation(async (sql) => {
    if (sql.includes("FROM users WHERE firebase_uid")) return { id: USER_ID, role: "student" };
    return null;
  });

  // Caches are module-level and would leak decisions between tests.
  const { clearAiConfigCache } = await import("../lib/ai/config");
  const { clearAiRateLimits } = await import("../lib/ai/guard");
  const { clearAllUserCache } = await import("../middleware/auth");
  clearAiConfigCache();
  clearAiRateLimits();
  clearAllUserCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authentication", () => {
  it("refuses every AI endpoint without a token", async () => {
    const endpoints: [string, object][] = [
      ["/api/v1/ai/chat", { messages: [{ role: "user", content: "hi" }] }],
      ["/api/v1/ai/scam-check", { text: "hello" }],
      ["/api/v1/ai/doc-check", { docType: "passport" }],
      ["/api/v1/ai/visa-roadmap", { origin: "Ghana", destination: "Canada" }],
      ["/api/v1/ai/readiness", {}],
      ["/api/v1/ai/score-essay", { essay: "hello" }],
      ["/api/v1/ai/compare-countries", { country1: "gh", country2: "ca" }],
      ["/api/v1/ai/translate", { texts: ["hi"], target: "fr" }],
    ];

    for (const [path, body] of endpoints) {
      const res = await request(app).post(path).send(body);
      // These spend money on every call. Anonymous access was the original sin
      // of the previous implementation.
      expect(res.status, path).toBe(401);
    }
  });

  it("rejects a revoked token with a distinguishable code", async () => {
    verifyIdToken.mockRejectedValue(
      Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" }),
    );
    const res = await request(app)
      .post("/api/v1/ai/scam-check")
      .set("Authorization", AUTH)
      .send({ text: "hello" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth/revoked");
  });
});

describe("scam shield", () => {
  it("returns a cautious heuristic result when no model is configured", async () => {
    const res = await request(app)
      .post("/api/v1/ai/scam-check")
      .set("Authorization", AUTH)
      .send({ text: "Nice flat, come and view it any afternoon this week." });

    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    // The load-bearing assertion: a degraded safety check never says "safe".
    expect(res.body.verdict).not.toBe("Likely safe");
  });

  it("returns the disabled shape when an admin switched it off", async () => {
    settingsRows = [{ key: "ai_scam_detection_enabled", value: false }];

    const res = await request(app)
      .post("/api/v1/ai/scam-check")
      .set("Authorization", AUTH)
      .send({ text: "wire the deposit today" });

    expect(res.status).toBe(200);
    expect(res.body.disabled).toBe(true);
    expect(res.body.verdict).toBe("Be cautious");
    expect(res.body.summary).toMatch(/turned off/i);
  });

  it("rejects an oversized paste with the actual limit", async () => {
    const res = await request(app)
      .post("/api/v1/ai/scam-check")
      .set("Authorization", AUTH)
      .send({ text: "x".repeat(6_001) });

    expect(res.status).toBe(413);
    expect(res.body.limit).toBe(6000);
  });

  it("validates the body", async () => {
    const res = await request(app)
      .post("/api/v1/ai/scam-check")
      .set("Authorization", AUTH)
      .send({ text: "" });
    expect(res.status).toBe(400);
  });
});

describe("document checker", () => {
  it("returns an unverified checklist when the model is unavailable", async () => {
    const res = await request(app)
      .post("/api/v1/ai/doc-check")
      .set("Authorization", AUTH)
      .send({ docType: "passport" });

    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.findings.every((f: { severity: string }) => f.severity === "warn")).toBe(true);
  });

  it("refuses an unknown document type", async () => {
    const res = await request(app)
      .post("/api/v1/ai/doc-check")
      .set("Authorization", AUTH)
      .send({ docType: "birth_certificate" });
    expect(res.status).toBe(400);
  });

  it("never caches a document response", async () => {
    const res = await request(app)
      .post("/api/v1/ai/doc-check")
      .set("Authorization", AUTH)
      .send({ docType: "passport" });
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

describe("essay scoring", () => {
  it("returns 503 rather than a fabricated review", async () => {
    // The one feature with no canned fallback: a fake review would quote
    // passages the user did not write, for a document they are about to submit.
    const res = await request(app)
      .post("/api/v1/ai/score-essay")
      .set("Authorization", AUTH)
      .send({ essay: "Ever since I was a kid..." });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ai/unavailable");
    expect(res.body.error).toMatch(/has not been changed/i);
  });
});

describe("translate", () => {
  it("short-circuits an English target without spending anything", async () => {
    const res = await request(app)
      .post("/api/v1/ai/translate")
      .set("Authorization", AUTH)
      .send({ texts: ["Hello", "Goodbye"], target: "en" });

    expect(res.status).toBe(200);
    expect(res.body.translations).toEqual(["Hello", "Goodbye"]);
    expect(res.body.degraded).toBeUndefined();
  });

  it("returns the source strings, flagged, when unavailable", async () => {
    const res = await request(app)
      .post("/api/v1/ai/translate")
      .set("Authorization", AUTH)
      .send({ texts: ["Hello"], target: "fr" });

    // A screen with English on it is bad. A screen with nothing on it is broken.
    expect(res.status).toBe(200);
    expect(res.body.translations).toEqual(["Hello"]);
    expect(res.body.degraded).toBe(true);
  });

  it("refuses a batch that is too large", async () => {
    const res = await request(app)
      .post("/api/v1/ai/translate")
      .set("Authorization", AUTH)
      .send({ texts: Array.from({ length: 201 }, () => "hi"), target: "fr" });
    expect(res.status).toBe(400);
  });
});

describe("compare countries", () => {
  it("refuses two identical countries", async () => {
    const res = await request(app)
      .post("/api/v1/ai/compare-countries")
      .set("Authorization", AUTH)
      .send({ country1: "gh", country2: "GH" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("compare/same-country");
  });

  it("refuses an unknown country code instead of inventing a comparison", async () => {
    const res = await request(app)
      .post("/api/v1/ai/compare-countries")
      .set("Authorization", AUTH)
      .send({ country1: "gh", country2: "zz" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("compare/unknown-country");
  });
});

describe("chat", () => {
  it("degrades honestly when the assistant is switched off", async () => {
    settingsRows = [{ key: "ai_chat_enabled", value: false }];

    const res = await request(app)
      .post("/api/v1/ai/chat")
      .set("Authorization", AUTH)
      .send({ messages: [{ role: "user", content: "How do I get a study permit?" }] });

    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.sources).toEqual([]);
    expect(res.body.reply).toMatch(/turned off by an admin/i);
  });

  it("rejects an empty message list", async () => {
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .set("Authorization", AUTH)
      .send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a prompt over the input ceiling", async () => {
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .set("Authorization", AUTH)
      .send({ messages: [{ role: "user", content: "x".repeat(24_001) }] });
    // max_tokens caps only the reply; without an input cap one request can
    // carry megabytes of prompt, which is the expensive half.
    expect(res.status).toBe(413);
  });
});

describe("spend ceiling", () => {
  it("refuses a request from an account already over budget", async () => {
    // 1M output tokens on gpt-4o is $10, well past the $1/day default.
    usageRows = [{ model: "gpt-4o", in_tok: "0", out_tok: "1000000", calls: "5" }];

    const res = await request(app)
      .post("/api/v1/ai/scam-check")
      .set("Authorization", AUTH)
      .send({ text: "hello" });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("ai/daily-ceiling");
    expect(res.body.resets_at).toBeTruthy();
    expect(res.headers["retry-after"]).toBeTruthy();
  });

  it("allows a request when the ledger is unreachable", async () => {
    // Failing closed would take the whole AI surface offline over an
    // infrastructure blip unrelated to anyone's budget.
    queryMock.mockImplementation(async (sql) => {
      if (sql.includes("FROM ai_usage_log")) throw new Error("connection refused");
      if (sql.includes("FROM platform_settings")) return [];
      return [];
    });

    const res = await request(app)
      .post("/api/v1/ai/scam-check")
      .set("Authorization", AUTH)
      .send({ text: "hello" });

    expect(res.status).toBe(200);
  });

  it("reports today's spend to the caller", async () => {
    usageRows = [{ model: "gpt-4o-mini", in_tok: "1000000", out_tok: "0", calls: "3" }];

    const res = await request(app).get("/api/v1/ai/usage/today").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.spent_usd).toBeCloseTo(0.15, 6);
    expect(res.body.calls).toBe(3);
    expect(res.body.exceeded).toBe(false);
  });
});

describe("burst limit", () => {
  it("cuts off a runaway client after the per-feature allowance", async () => {
    // visa-roadmap allows 8/min.
    const send = () =>
      request(app)
        .post("/api/v1/ai/visa-roadmap")
        .set("Authorization", AUTH)
        .send({ origin: "Ghana", destination: "Canada" });

    for (let i = 0; i < 8; i++) {
      const res = await send();
      expect(res.status, `call ${i + 1}`).toBe(200);
    }

    const ninth = await send();
    expect(ninth.status).toBe(429);
    expect(ninth.body.code).toBe("ai/rate-limited");
    expect(ninth.headers["retry-after"]).toBeTruthy();
  });
});

describe("ai status", () => {
  it("reports which features the client may offer", async () => {
    const res = await request(app).get("/api/v1/ai/status").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.degraded).toBe(true);
    // Needs the model.
    expect(res.body.features.chat).toBe(false);
    expect(res.body.features["score-essay"]).toBe(false);
    // Useful without it, so offered as degraded rather than hidden.
    expect(res.body.features["scam-check"]).toBe(true);
    expect(res.body.features["visa-roadmap"]).toBe(true);
  });
});

describe("model coercion", () => {
  it("refuses a model from the wrong provider and warns", async () => {
    // The bug this exists for: the web platform seeded ai_model to a Claude
    // model while the client speaks the OpenAI API, so every call failed and
    // silently returned canned output — an AI that looked like it worked.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    settingsRows = [{ key: "ai_model", value: "claude-haiku-4-5" }];

    const res = await request(app).get("/api/v1/ai/status").set("Authorization", AUTH);

    expect(res.body.model).toBe("gpt-4o-mini");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not an OpenAI model id"));
    warn.mockRestore();
  });

  it("passes through a valid OpenAI model it has not seen before", async () => {
    // New models ship faster than this file is edited; refusing an unknown-but
    // -valid one would be a self-inflicted outage.
    settingsRows = [{ key: "ai_model", value: "gpt-5-turbo" }];

    const res = await request(app).get("/api/v1/ai/status").set("Authorization", AUTH);
    expect(res.body.model).toBe("gpt-5-turbo");
  });

  it("clamps an out-of-range temperature instead of passing it to the provider", async () => {
    settingsRows = [{ key: "ai_temperature", value: 9 }];
    const { getAiConfig, clearAiConfigCache } = await import("../lib/ai/config");
    clearAiConfigCache();
    const config = await getAiConfig();
    expect(config.ai_temperature).toBe(2);
  });
});
