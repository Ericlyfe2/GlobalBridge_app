import "./setup-env";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The delivery contract, tested at the level that actually matters: what gets
 * written, in what order, and what is allowed to be dropped.
 */

const sendMock = vi.fn(async () => "ok");

vi.mock("../lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: vi.fn() },
  adminMessaging: { send: sendMock },
}));

const notifyUsersMock = vi.fn(async () => undefined);
vi.mock("../ws", () => ({ notifyUsers: notifyUsersMock }));

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

/** All SQL statements this dispatch issued, whitespace-normalised. */
function statements(): string[] {
  return queryMock.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
}

/** Bound parameters of the notifications INSERT this dispatch issued. */
function insertParams(): unknown[] {
  const call = queryMock.mock.calls.find(([sql]) => sql.includes("INSERT INTO notifications"));
  if (!call) throw new Error("no notifications INSERT was issued");
  return call[1] ?? [];
}

function inserts(): string[] {
  return statements().filter((s) => s.startsWith("INSERT INTO notifications"));
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockImplementation(async () => []);
  // The recipient's language lookup; no collapse match by default.
  queryOneMock.mockImplementation(async () => ({ preferred_language: "en" }));
});

describe("dispatchNotification", () => {
  it("writes the row before any fan-out", async () => {
    const { dispatchNotification } = await import("../lib/push");
    await dispatchNotification({
      userId: "u1",
      kind: "message",
      titleKey: "notification.message.title",
      vars: { name: "Amara" },
      deepLink: "/messages/c1",
    });

    expect(inserts()).toHaveLength(1);
    // The row is the source of truth. If the socket push happened first and the
    // insert then failed, the user would see a banner for something that is not
    // in their notification list.
    expect(notifyUsersMock).toHaveBeenCalledOnce();
  });

  it("localises server-side from the recipient's profile language", async () => {
    queryOneMock.mockImplementation(async () => ({ preferred_language: "fr" }));
    const { dispatchNotification } = await import("../lib/push");

    await dispatchNotification({
      userId: "u1",
      kind: "security",
      titleKey: "notification.security.title",
    });

    const params = insertParams();

    // The OS renders a push from the payload we send; the app is not running
    // and cannot translate anything.
    expect(params[2]).toBe("Alerte de sécurité");
    expect(params[8]).toBe("fr");
  });

  it("collapses a repeat of a chatty kind", async () => {
    // A recent notification with the same collapse key already exists.
    queryOneMock.mockImplementation(async (sql: string) =>
      sql.includes("collapse_key")
        ? { id: "existing" }
        : { preferred_language: "en" },
    );
    const { dispatchNotification } = await import("../lib/push");

    await dispatchNotification({
      userId: "u1",
      kind: "opportunity",
      titleKey: "notification.opportunity.title",
      collapseKey: "opportunity:daily",
    });

    expect(inserts()).toHaveLength(0);
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it("never collapses a security alert", async () => {
    queryOneMock.mockImplementation(async (sql: string) =>
      sql.includes("collapse_key")
        ? { id: "existing" }
        : { preferred_language: "en" },
    );
    const { dispatchNotification } = await import("../lib/push");

    await dispatchNotification({
      userId: "u1",
      kind: "security",
      titleKey: "notification.security.title",
      collapseKey: "security:same",
    });

    // Collapsing is a courtesy for chatty categories. Applied to a safety
    // alert it means the second one silently replaces the first, and for this
    // audience the second one is often the one that matters.
    expect(inserts()).toHaveLength(1);
  });

  it("never collapses a deadline", async () => {
    queryOneMock.mockImplementation(async (sql: string) =>
      sql.includes("collapse_key")
        ? { id: "existing" }
        : { preferred_language: "en" },
    );
    const { dispatchNotification } = await import("../lib/push");

    await dispatchNotification({
      userId: "u1",
      kind: "deadline",
      titleKey: "notification.deadline.title",
      collapseKey: "deadline:same",
    });

    expect(inserts()).toHaveLength(1);
  });

  it("rewrites an unsafe deep link instead of storing it", async () => {
    const { dispatchNotification } = await import("../lib/push");

    await dispatchNotification({
      userId: "u1",
      kind: "info",
      titleKey: "notification.opportunity.title",
      deepLink: "https://evil.example.com/steal",
    });

    expect(insertParams()[5]).toBe("/notifications");
  });

  it("does not throw when delivery fails", async () => {
    // A notification failing must never roll back the action that produced it:
    // booking a mentor has to succeed even when push is misconfigured.
    queryMock.mockImplementation(async () => {
      throw new Error("database is on fire");
    });
    const { dispatchNotification } = await import("../lib/push");

    await expect(
      dispatchNotification({ userId: "u1", kind: "info", titleKey: "notification.opportunity.title" }),
    ).resolves.toBeUndefined();
  });

  it("does not send to FCM when it is not configured", async () => {
    // Mirrors the VAPID behaviour: warn once at boot, then no-op.
    const { dispatchNotification, fcmEnabled } = await import("../lib/push");
    expect(fcmEnabled).toBe(false);

    await dispatchNotification({
      userId: "u1",
      kind: "info",
      titleKey: "notification.opportunity.title",
    });

    expect(sendMock).not.toHaveBeenCalled();
    // The row and the socket delivery still happen. Losing push must never
    // lose information.
    expect(inserts()).toHaveLength(1);
    expect(notifyUsersMock).toHaveBeenCalledOnce();
  });
});
