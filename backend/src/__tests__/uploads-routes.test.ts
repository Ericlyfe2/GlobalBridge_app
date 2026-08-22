import "./setup-env";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * The upload endpoints, with the object store and the processing pipeline
 * stubbed. What is under test here is the state machine and the authorization
 * boundary — the byte-level work has its own suite.
 */

const verifyIdToken = vi.fn();
vi.mock("../lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken },
  adminMessaging: { send: vi.fn() },
}));

let storageConfigured = true;

const presignUpload = vi.fn(async () => "https://bucket.example.com/signed-put");
const presignRead = vi.fn(async () => "https://bucket.example.com/signed-get");
const deleteObject = vi.fn(async () => undefined);

vi.mock("../lib/uploads/storage", () => ({
  get storageConfigured() {
    return storageConfigured;
  },
  storageDescription: () => "test",
  presignUpload: (...args: unknown[]) => presignUpload(...(args as [])),
  presignRead: (...args: unknown[]) => presignRead(...(args as [])),
  deleteObject: (...args: unknown[]) => deleteObject(...(args as [])),
  quarantineKey: (userId: string, docId: string) => `quarantine/${userId}/${docId}`,
  UPLOAD_URL_TTL_SECONDS: 900,
  READ_URL_TTL_SECONDS: 300,
}));

type ProcessResult =
  | {
      ok: true;
      storageKey: string;
      thumbnailKey: string | null;
      mimeType: string;
      sizeBytes: number;
      checksum: string;
      width: number | null;
      height: number | null;
      strippedMetadata: boolean;
    }
  | { ok: false; reason: string; code: string };

let processResult: ProcessResult = {
  ok: true,
  storageKey: "document/user/1-abc.jpg",
  thumbnailKey: "document/user/1-abc.jpg.thumb.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1024,
  checksum: "a".repeat(64),
  width: 1200,
  height: 900,
  strippedMetadata: true,
};

const processUpload = vi.fn(async () => processResult);
vi.mock("../lib/uploads/process", () => ({
  processUpload: () => processUpload(),
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
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "33333333-3333-4333-8333-333333333333";

let app: Express;

beforeAll(async () => {
  const { createApp } = await import("../app");
  app = createApp();
});

/** Bytes the quota query reports as already used. */
let usedBytes = 0;
/** The row the document lookups return. */
let documentRow: Record<string, unknown> | null = null;

beforeEach(async () => {
  vi.clearAllMocks();
  storageConfigured = true;
  usedBytes = 0;
  documentRow = null;
  processResult = {
    ok: true,
    storageKey: "document/user/1-abc.jpg",
    thumbnailKey: "document/user/1-abc.jpg.thumb.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    checksum: "a".repeat(64),
    width: 1200,
    height: 900,
    strippedMetadata: true,
  };

  verifyIdToken.mockResolvedValue({ uid: "firebase-uid", email: "student@example.com" });

  queryMock.mockImplementation(async () => []);
  queryOneMock.mockImplementation(async (sql) => {
    if (sql.includes("FROM users WHERE firebase_uid")) return { id: USER_ID, role: "student" };
    if (sql.includes("SUM(size_bytes)")) return { total: String(usedBytes) };
    if (sql.includes("INSERT INTO user_documents")) return { id: DOC_ID };
    if (sql.includes("FROM user_documents")) return documentRow;
    if (sql.includes("UPDATE user_documents")) return { id: DOC_ID, status: "ready" };
    return null;
  });

  const { clearAllUserCache } = await import("../middleware/auth");
  clearAllUserCache();
});

describe("authentication", () => {
  it("requires a token on every endpoint", async () => {
    const calls: [string, string][] = [
      ["post", "/api/v1/uploads/presign"],
      ["post", `/api/v1/uploads/${DOC_ID}/complete`],
      ["get", "/api/v1/uploads"],
      ["get", `/api/v1/uploads/${DOC_ID}`],
      ["delete", `/api/v1/uploads/${DOC_ID}`],
    ];
    for (const [method, path] of calls) {
      const res = await (request(app) as never as Record<string, (p: string) => never>)[method](path);
      expect((res as unknown as { status: number }).status, path).toBe(401);
    }
  });
});

describe("presign", () => {
  const body = {
    type: "passport",
    purpose: "document",
    content_type: "image/jpeg",
    size_bytes: 2_000_000,
    filename: "passport.jpg",
  };

  it("creates a pending row and returns a URL the client PUTs to", async () => {
    const res = await request(app)
      .post("/api/v1/uploads/presign")
      .set("Authorization", AUTH)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.document_id).toBe(DOC_ID);
    expect(res.body.upload_url).toBe("https://bucket.example.com/signed-put");
    expect(res.body.method).toBe("PUT");
    // Signed into the URL, so the client has to send exactly this.
    expect(res.body.headers["Content-Type"]).toBe("image/jpeg");

    const insert = queryOneMock.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO user_documents"),
    )!;
    // The row starts pending. Nothing is servable until the bytes are checked.
    expect(insert[0]).toContain("'pending'");
  });

  it("uploads into a quarantine prefix, not the durable one", async () => {
    await request(app).post("/api/v1/uploads/presign").set("Authorization", AUTH).send(body);

    const [key] = presignUpload.mock.calls[0] as unknown as [string];
    // Between the PUT and validation the object is arbitrary attacker-controlled
    // bytes that happen to be in our bucket.
    expect(key).toContain("quarantine/");
    expect(key).toContain(USER_ID);
  });

  it("rejects a file over the single-upload limit before issuing anything", async () => {
    const res = await request(app)
      .post("/api/v1/uploads/presign")
      .set("Authorization", AUTH)
      .send({ ...body, size_bytes: 40_000_000 });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("upload/too-large");
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it("rejects an upload that would exceed the account quota", async () => {
    usedBytes = 99 * 1024 * 1024;

    const res = await request(app)
      .post("/api/v1/uploads/presign")
      .set("Authorization", AUTH)
      .send(body);

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("upload/quota-exceeded");
    // The message tells them what to do about it.
    expect(res.body.error).toMatch(/Delete a file/i);
  });

  it("refuses a content type that is not on the list", async () => {
    const res = await request(app)
      .post("/api/v1/uploads/presign")
      .set("Authorization", AUTH)
      .send({ ...body, content_type: "image/svg+xml" });

    expect(res.status).toBe(400);
  });

  it("reports uploads unavailable rather than half-working with no bucket", async () => {
    storageConfigured = false;

    const res = await request(app)
      .post("/api/v1/uploads/presign")
      .set("Authorization", AUTH)
      .send(body);

    // Accepting an identity document onto an ephemeral filesystem is how
    // passport scans vanish on the next deploy.
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("storage/not-configured");
  });
});

describe("complete", () => {
  beforeEach(() => {
    documentRow = {
      id: DOC_ID,
      user_id: USER_ID,
      status: "pending",
      purpose: "document",
      original_filename: "passport.jpg",
    };
  });

  it("promotes a validated upload to ready", async () => {
    const res = await request(app)
      .post(`/api/v1/uploads/${DOC_ID}/complete`)
      .set("Authorization", AUTH)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.metadata_stripped).toBe(true);

    const update = queryOneMock.mock.calls.find(([sql]) =>
      sql.includes("UPDATE user_documents") && sql.includes("'ready'"),
    );
    expect(update).toBeTruthy();
  });

  it("tells the user their location data was removed", async () => {
    const res = await request(app)
      .post(`/api/v1/uploads/${DOC_ID}/complete`)
      .set("Authorization", AUTH)
      .send({});

    // Silently altering someone's file is worse than altering it and saying so.
    expect(res.body.metadata_stripped).toBe(true);
    expect(res.body.dimensions).toEqual({ width: 1200, height: 900 });
  });

  it("marks a failed validation rejected and says why", async () => {
    processResult = {
      ok: false,
      code: "upload/unsupported-type",
      reason: "That file type is not supported. Upload a JPEG, PNG, WEBP, HEIC or PDF.",
    };

    const res = await request(app)
      .post(`/api/v1/uploads/${DOC_ID}/complete`)
      .set("Authorization", AUTH)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("upload/unsupported-type");
    expect(res.body.status).toBe("rejected");

    const marked = queryMock.mock.calls.find(([sql]) => sql.includes("'rejected'"));
    expect(marked).toBeTruthy();
  });

  it("deletes the stored object when the measured size blows the quota", async () => {
    // The declared size at presign is a client claim. This is the real check.
    usedBytes = 100 * 1024 * 1024;

    const res = await request(app)
      .post(`/api/v1/uploads/${DOC_ID}/complete`)
      .set("Authorization", AUTH)
      .send({});

    expect(res.status).toBe(413);
    expect(deleteObject).toHaveBeenCalled();
  });

  it("is idempotent for a client that retried after a dropped response", async () => {
    documentRow = { ...documentRow, status: "ready" };

    const res = await request(app)
      .post(`/api/v1/uploads/${DOC_ID}/complete`)
      .set("Authorization", AUTH)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.already_processed).toBe(true);
    // No second round of fetching and re-encoding.
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("will not complete somebody else's upload", async () => {
    documentRow = null; // the query is scoped by user_id, so nothing comes back

    const res = await request(app)
      .post(`/api/v1/uploads/${DOC_ID}/complete`)
      .set("Authorization", AUTH)
      .send({});

    expect(res.status).toBe(404);
    expect(processUpload).not.toHaveBeenCalled();
  });
});

describe("read authorization", () => {
  it("issues a short-lived URL to the owner", async () => {
    documentRow = {
      id: DOC_ID,
      user_id: USER_ID,
      purpose: "document",
      status: "ready",
      storage_key: "document/user/1-abc.jpg",
      thumbnail_key: null,
      mime_type: "image/jpeg",
      original_filename: "passport.jpg",
    };

    const res = await request(app).get(`/api/v1/uploads/${DOC_ID}`).set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://bucket.example.com/signed-get");
    expect(res.body.expires_in).toBe(300);
    // The URL is a bearer capability for someone's passport scan.
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("hides another user's private document behind a 404", async () => {
    documentRow = {
      id: DOC_ID,
      user_id: OTHER_USER,
      purpose: "document",
      status: "ready",
      storage_key: "document/other/1-abc.jpg",
      thumbnail_key: null,
      mime_type: "image/jpeg",
      original_filename: null,
    };

    const res = await request(app).get(`/api/v1/uploads/${DOC_ID}`).set("Authorization", AUTH);

    // 404 rather than 403: a 403 confirms a document exists at this id and
    // belongs to someone else.
    expect(res.status).toBe(404);
    expect(presignRead).not.toHaveBeenCalled();
  });

  it("lets a signed-in user read another user's avatar", async () => {
    documentRow = {
      id: DOC_ID,
      user_id: OTHER_USER,
      purpose: "avatar",
      status: "ready",
      storage_key: "avatar/other/1-abc.jpg",
      thumbnail_key: null,
      mime_type: "image/jpeg",
      original_filename: null,
    };

    const res = await request(app).get(`/api/v1/uploads/${DOC_ID}`).set("Authorization", AUTH);
    expect(res.status).toBe(200);
  });

  it("will not serve a document that is still pending", async () => {
    documentRow = {
      id: DOC_ID,
      user_id: USER_ID,
      purpose: "document",
      status: "pending",
      storage_key: null,
      thumbnail_key: null,
      mime_type: "image/jpeg",
      original_filename: null,
    };

    const res = await request(app).get(`/api/v1/uploads/${DOC_ID}`).set("Authorization", AUTH);

    // Unvalidated bytes are never servable.
    expect(res.status).toBe(404);
  });

  it("never returns storage keys in a listing", async () => {
    queryMock.mockImplementation(async (sql) => {
      if (sql.includes("FROM user_documents")) {
        return [
          {
            id: DOC_ID,
            type: "passport",
            purpose: "document",
            status: "ready",
            mime_type: "image/jpeg",
            size_bytes: 1024,
            has_thumbnail: true,
            total_count: "1",
          },
        ];
      }
      return [];
    });

    const res = await request(app).get("/api/v1/uploads").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    // Handing out keys invites clients to construct URLs instead of asking for
    // one, which is where the authorization check lives.
    expect(JSON.stringify(res.body)).not.toContain("storage_key");
  });
});

describe("delete", () => {
  it("removes the row and both objects", async () => {
    documentRow = {
      storage_key: "document/user/1-abc.jpg",
      thumbnail_key: "document/user/1-abc.jpg.thumb.jpg",
    };

    const res = await request(app).delete(`/api/v1/uploads/${DOC_ID}`).set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it("will not delete a document the caller does not own", async () => {
    documentRow = null; // scoped by user_id in the query

    const res = await request(app).delete(`/api/v1/uploads/${DOC_ID}`).set("Authorization", AUTH);

    expect(res.status).toBe(404);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  it("tells the client whether to offer uploads at all", async () => {
    const res = await request(app).get("/api/v1/uploads/meta/status").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.max_bytes).toBeGreaterThan(0);
    expect(res.body.accepted_types).toContain("image/heic");
  });

  it("reports unavailable with no bucket configured", async () => {
    storageConfigured = false;
    const res = await request(app).get("/api/v1/uploads/meta/status").set("Authorization", AUTH);
    expect(res.body.available).toBe(false);
  });
});
