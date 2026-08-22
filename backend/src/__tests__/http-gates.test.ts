import "./setup-env";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Route-handler tests for the two gates every mobile request passes through
 * before it reaches a handler: the minimum-version check and the CSRF origin
 * check.
 *
 * Both were previously the kind of thing verified once by hand against a
 * running server and then never again. They are exactly the kind of thing that
 * regresses silently -- a widened CSRF carve-out still returns 200 to every
 * legitimate caller.
 */

// Firebase Admin initialises at import time and would try to mint credentials.
vi.mock("../lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: vi.fn() },
  adminMessaging: { send: vi.fn() },
}));

// No Postgres in unit tests. app-config falls back to its defaults when the
// settings lookup fails, which is the behaviour under test elsewhere.
vi.mock("../db", () => ({
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
  redis: null,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  withTransaction: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  const { createApp } = await import("../app");
  app = createApp();
});

describe("minimum-version gate", () => {
  it("refuses a build below the floor with 426 and a structured body", async () => {
    const res = await request(app)
      .get("/api/v1/housing")
      .set("X-Client-Platform", "ios")
      .set("X-Client-Version", "1.1.0");

    expect(res.status).toBe(426);
    expect(res.body.code).toBe("client/update-required");
    // The app renders a blocking update screen from these; a bare 426 would
    // leave it with nothing to show but an error code.
    expect(res.body.minSupportedVersion).toBe("1.2.0");
    expect(res.body.latestVersion).toBe("1.5.0");
    expect(res.body.updateUrl).toMatch(/^https:\/\//);
  });

  it("sends the platform's own store URL", async () => {
    const ios = await request(app)
      .get("/api/v1/housing")
      .set("X-Client-Platform", "ios")
      .set("X-Client-Version", "1.0.0");
    const android = await request(app)
      .get("/api/v1/housing")
      .set("X-Client-Platform", "android")
      .set("X-Client-Version", "1.0.0");

    expect(ios.body.updateUrl).toContain("apple.com");
    expect(android.body.updateUrl).toContain("play.google.com");
  });

  it("lets a supported build through", async () => {
    const res = await request(app)
      .get("/api/v1/housing")
      .set("X-Client-Platform", "ios")
      .set("X-Client-Version", "1.2.0");

    expect(res.status).not.toBe(426);
  });

  it("does not gate the web frontend or server-to-server callers", async () => {
    // No version headers at all -- the existing web proxy. Gating it would
    // break every current consumer to protect a client that does not exist yet.
    const res = await request(app).get("/api/housing");
    expect(res.status).not.toBe(426);
  });

  it("still serves app-config to a refused build", async () => {
    // This is how the app learns why it was blocked and where to update. If the
    // gate covered it, the update screen would have nothing to render.
    const res = await request(app)
      .get("/api/v1/app-config")
      .set("X-Client-Platform", "android")
      .set("X-Client-Version", "0.1.0");

    expect(res.status).toBe(200);
    expect(res.body.minSupportedVersion).toBe("1.2.0");
  });

  it("still serves health to a refused build", async () => {
    const res = await request(app)
      .get("/health")
      .set("X-Client-Platform", "ios")
      .set("X-Client-Version", "0.0.1");
    expect(res.status).toBe(200);
  });

  it("does not refuse an unparseable version", async () => {
    const res = await request(app)
      .get("/api/v1/housing")
      .set("X-Client-Platform", "ios")
      .set("X-Client-Version", "not-a-version");
    expect(res.status).not.toBe(426);
  });
});

describe("CSRF origin check", () => {
  it("refuses a mutating request carrying a forged Origin", async () => {
    const res = await request(app)
      .post("/api/v1/users/device-tokens")
      .set("Origin", "http://evil.example.com")
      .set("Authorization", "Bearer whatever")
      .send({ token: "x".repeat(40), platform: "ios" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("security/csrf");
  });

  it("allows a mutating request from an allow-listed origin", async () => {
    const res = await request(app)
      .post("/api/v1/users/device-tokens")
      .set("Origin", "http://localhost:3000")
      .send({ token: "x".repeat(40), platform: "ios" });

    // Passes CSRF and is then rejected by auth, which is the correct order:
    // 401, not 403.
    expect(res.status).toBe(401);
  });

  it("allows the Expo dev client origin", async () => {
    const res = await request(app)
      .post("/api/v1/users/device-tokens")
      .set("Origin", "http://localhost:8081")
      .send({ token: "x".repeat(40), platform: "android" });

    expect(res.status).toBe(401);
  });

  it("allows a header-less request, which is what a native build sends", async () => {
    // No Origin, no Referer. This is not a CSRF vector because the request
    // still has to carry a Bearer token that a browser cannot be tricked into
    // attaching. It must reach auth, not be refused at the gate.
    const res = await request(app)
      .post("/api/v1/users/device-tokens")
      .send({ token: "x".repeat(40), platform: "ios" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth/missing-token");
  });

  it("does not apply to safe methods", async () => {
    const res = await request(app)
      .get("/api/v1/app-config")
      .set("Origin", "http://evil.example.com");
    expect(res.status).toBe(200);
  });
});

describe("app-config", () => {
  it("returns the cold-start payload in one call", async () => {
    const res = await request(app).get("/api/v1/app-config");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      minSupportedVersion: "1.2.0",
      latestVersion: "1.5.0",
      maintenanceMode: false,
      websocketPath: "/ws",
    });
    // Both halves in one response -- the whole point of folding the AI config
    // in rather than making the app pay two round trips on a cold start.
    expect(res.body.features.scamShield).toBe(true);
    expect(res.body.aiConfig.scamCheck).toEqual({ enabled: true, model: null });
    expect(res.body.locales).toContain("ar");
  });

  it("is cacheable, because it contains nothing user-specific", async () => {
    const res = await request(app).get("/api/v1/app-config");
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });
});

describe("version aliasing", () => {
  it("serves the same router at /api/v1 and the unversioned path", async () => {
    const versioned = await request(app).get("/api/v1/app-config");
    const legacy = await request(app).get("/api/app-config");

    expect(versioned.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(versioned.body);
  });
});

describe("unknown routes", () => {
  it("answers with JSON, not an HTML error page", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("server/not-found");
  });
});
