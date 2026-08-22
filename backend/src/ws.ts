// @types/ws exposes the class via `export =`, so WebSocket has to be the
// default import -- a named one resolves to a self-referential alias.
import WebSocket, { WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "http";
import type Redis from "ioredis";
import { redis, queryOne } from "./db";
import { adminAuth } from "./lib/firebase-admin";

/**
 * Real-time fan-out for a client that sleeps.
 *
 * Two things make a mobile socket different from a browser tab:
 *
 * 1. The OS kills backgrounded sockets without telling either end. TCP will
 *    happily hold a half-open connection for a long time, so the server keeps
 *    "delivering" to a socket nobody is reading -- which looks like working
 *    delivery right up until the user notices they missed a message. The
 *    heartbeat below is what turns that into a detectable close.
 *
 * 2. A socket that was down has no replay. Reconnecting gets you new messages
 *    and a silent hole where the ones you missed were. That is fixed at the
 *    REST layer (GET /messages/since, GET /notifications?since=), not here --
 *    the socket's job is liveness, not history.
 */

type Client = WebSocket & {
  userId?: string;
  firebaseUid?: string;
  authed?: boolean;
  isAlive?: boolean;
};

const clients = new Map<string, Set<Client>>();

/** How long a connection may stay unauthenticated before it is closed. */
export const AUTH_TIMEOUT_MS = 10_000;

/** Heartbeat period. Comfortably under the ~60s idle timeout most mobile NATs impose. */
export const HEARTBEAT_MS = 30_000;

let subRedis: Redis | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

export const WS_CLOSE = {
  AUTH_TIMEOUT: 1008,
  INVALID_AUTH: 1008,
  USER_NOT_FOUND: 1008,
} as const;

/**
 * Authenticate a socket from a Firebase ID token.
 *
 * checkRevoked=true matches requireAuth. Without it, a suspended account's
 * still-unexpired token opens a live socket and keeps receiving that user's
 * private messages until the JWT expires on its own -- the suspension would
 * apply to REST and not to real-time, which is the worse half to miss.
 */
async function authenticate(token: string): Promise<{ userId: string; firebaseUid: string } | null> {
  const decoded = await adminAuth.verifyIdToken(token, true);
  const row = await queryOne<{ id: string }>(`SELECT id FROM users WHERE firebase_uid = $1`, [
    decoded.uid,
  ]);
  if (!row) return null;
  return { userId: row.id, firebaseUid: decoded.uid };
}

export function initWebsocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    perMessageDeflate: { zlibDeflateOptions: { level: 6 } },
  });

  wss.on("connection", (raw: WebSocket, req: IncomingMessage) => {
    const ws = raw as Client;
    ws.authed = false;
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    const authTimer = setTimeout(() => {
      if (!ws.authed) ws.close(WS_CLOSE.AUTH_TIMEOUT, "Auth timeout");
    }, AUTH_TIMEOUT_MS);

    const onAuthenticated = (userId: string, firebaseUid: string) => {
      clearTimeout(authTimer);
      ws.userId = userId;
      ws.firebaseUid = firebaseUid;
      ws.authed = true;
      addClient(userId, ws);
      ws.send(JSON.stringify({ type: "auth_ok" }));
    };

    const fail = (reason: string) => {
      clearTimeout(authTimer);
      ws.close(WS_CLOSE.INVALID_AUTH, reason);
    };

    // ── Path A: token in the query string ─────────────────────────────────
    // Kept for the web client, which already connects this way. It is tolerable
    // over wss:// but not good: a query string lands in proxy logs, access logs
    // and error reporting, which is a durable copy of a live credential in
    // places that are not treated as secret. New clients use path B.
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const queryToken = url.searchParams.get("token");

    if (queryToken) {
      authenticate(queryToken)
        .then((result) => {
          if (!result) return fail("User not found");
          onAuthenticated(result.userId, result.firebaseUid);
          attachMessageHandler(ws);
        })
        .catch(() => fail("Invalid auth"));
      return;
    }

    // ── Path B: first message is { type: "auth", token } ──────────────────
    // The token travels in the frame body, which is not logged by
    // infrastructure the way a URL is. This is what the app uses.
    ws.once("message", async (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.type !== "auth" || typeof msg.token !== "string") {
          return fail("Expected auth message");
        }
        const result = await authenticate(msg.token);
        if (!result) return fail("User not found");
        onAuthenticated(result.userId, result.firebaseUid);
        attachMessageHandler(ws);
      } catch {
        fail("Invalid auth");
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (ws.userId) removeClient(ws.userId, ws);
    });

    ws.on("error", () => {
      /* close handler does the cleanup */
    });
  });

  // ── Dead-socket sweep ───────────────────────────────────────────────────
  // Every socket that did not answer the previous ping is terminated, not
  // closed: a half-open connection will never complete a closing handshake, so
  // close() would leave it in the map indefinitely.
  heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients as Set<Client>) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  // Do not hold the process open purely to run a heartbeat.
  heartbeatTimer.unref?.();

  if (redis) {
    subRedis = redis.duplicate();
    subRedis.subscribe("ws:broadcast");
    subRedis.on("message", (_channel, raw) => {
      try {
        const { userIds, payload } = JSON.parse(raw);
        deliverLocal(userIds, payload);
      } catch {
        /* ignore malformed broadcast */
      }
    });
    console.log("🔌 WebSocket on /ws (Redis pub/sub, multi-instance)");
  } else {
    console.log("🔌 WebSocket on /ws (single-instance, no Redis)");
  }

  server.on("close", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (subRedis) {
      subRedis.unsubscribe();
      subRedis.quit();
      subRedis = null;
    }
    wss.close();
  });

  return wss;
}

/**
 * Post-auth messages. The client-initiated ping is separate from the protocol
 * ping above: an app coming back to the foreground wants to know *now* whether
 * its socket is still real, without waiting up to a full heartbeat period.
 */
function attachMessageHandler(ws: Client) {
  ws.on("message", (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg?.type === "ping") ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
    } catch {
      /* ignore */
    }
  });
}

function addClient(userId: string, ws: Client) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(ws);
}

function removeClient(userId: string, ws: Client) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) clients.delete(userId);
}

function deliverLocal(userIds: string[], payload: unknown) {
  const body = JSON.stringify(payload);
  for (const id of userIds) {
    const set = clients.get(id);
    if (!set) continue;
    for (const c of set) {
      if (c.readyState === WebSocket.OPEN) c.send(body);
    }
  }
}

/** True when the user has at least one live socket on *this* instance. */
export function hasLiveSocket(userId: string): boolean {
  const set = clients.get(userId);
  if (!set) return false;
  for (const c of set) if (c.readyState === WebSocket.OPEN) return true;
  return false;
}

/**
 * Deliver to every device a user has open.
 *
 * With Redis this publishes and returns -- including to this instance, via its
 * own subscription -- so one code path covers one instance and twenty.
 */
export async function notifyUsers(userIds: string[], payload: unknown): Promise<void> {
  if (redis) {
    await redis.publish("ws:broadcast", JSON.stringify({ userIds, payload }));
    return;
  }
  deliverLocal(userIds, payload);
}
