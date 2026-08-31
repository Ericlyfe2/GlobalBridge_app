import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { Platform } from "react-native";
import Constants from "expo-constants";

/**
 * The API client.
 *
 * Every authenticated request goes through here so no screen has to think about
 * tokens, versions or session expiry.
 *
 * ── Token refresh, and why the parameter matters ──────────────────────────
 * Firebase ID tokens last about an hour and the SDK refreshes them on its own
 * schedule. `getIdToken(false)` returns the cached one, minting a new token
 * only if the old has actually expired; `getIdToken(true)` forces a network
 * round trip to Google.
 *
 * Attaching a *forced* token to every request — which is what this client did
 * before — puts a Firebase round trip in front of every single API call. On a
 * dorm or campus connection that roughly doubles the latency of the whole app,
 * for no benefit: the cached token is valid by definition until it expires.
 *
 * So: `false` on the way out, and `true` exactly once on a 401. That is the
 * §3.4 rule, and it is why `getToken` takes a parameter at all. Without one the
 * retry re-sends the token that was just rejected and fails identically — the
 * retry looks implemented and does nothing.
 *
 * ── Why a backgrounded app makes this matter more than on web ─────────────
 * A backgrounded phone misses the SDK's proactive refresh far more often than a
 * backgrounded tab does. Coming back to the app after forty minutes with an
 * expired token is the normal case here, not the edge case.
 */

const API_BASE =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  "http://localhost:4100";

/**
 * Sent on every request so the server can apply the minimum-version gate.
 *
 * Read from the manifest rather than hard-coded: a hard-coded string is one
 * more thing to forget at release, and forgetting it means the gate compares
 * against a version that was never shipped.
 */
const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

export const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 30_000,
  headers: {
    "Content-Type": "application/json",
    "X-Client-Platform": Platform.OS,
    "X-Client-Version": APP_VERSION,
  },
});

/** Raised for anything the UI needs to distinguish. */
export class ApiError extends Error {
  constructor(
    public status: number | undefined,
    public code: string | undefined,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenGetter = (forceRefresh: boolean) => Promise<string | null>;

let getToken: TokenGetter | null = null;
let onSessionEnded: (() => void) | null = null;
let onUpdateRequired: ((info: UpdateRequired) => void) | null = null;
let onMaintenance: ((retryAfterSeconds: number) => void) | null = null;

export type UpdateRequired = {
  minSupportedVersion: string;
  latestVersion: string;
  updateUrl: string;
};

export function configureApi(opts: {
  getToken: TokenGetter;
  onSessionEnded: () => void;
  onUpdateRequired: (info: UpdateRequired) => void;
  onMaintenance: (retryAfterSeconds: number) => void;
}) {
  getToken = opts.getToken;
  onSessionEnded = opts.onSessionEnded;
  onUpdateRequired = opts.onUpdateRequired;
  onMaintenance = opts.onMaintenance;
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (getToken) {
    // Cached token. See the note above on why this is not `true`.
    const token = await getToken(false);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Marks a request that has already been retried, so it cannot loop. */
type Retryable = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const body = error.response?.data as Record<string, unknown> | undefined;
    const code = typeof body?.code === "string" ? body.code : undefined;
    const message = typeof body?.error === "string" ? body.error : error.message;

    // ── 426: this build is below the server's floor ─────────────────────
    // Surfaced before anything else. There is no point refreshing a token for
    // a build the server will refuse regardless.
    if (status === 426) {
      onUpdateRequired?.({
        minSupportedVersion: String(body?.minSupportedVersion ?? ""),
        latestVersion: String(body?.latestVersion ?? ""),
        updateUrl: String(body?.updateUrl ?? ""),
      });
      throw new ApiError(status, code, message);
    }

    // ── 503 server/maintenance: the whole API is down for everyone ──────
    // Same "no screen should render normally" treatment as 426 — retrying
    // the token or the request cannot help when the server itself refused it.
    if (status === 503 && code === "server/maintenance") {
      const retryAfter = Number(error.response?.headers?.["retry-after"]);
      onMaintenance?.(Number.isFinite(retryAfter) ? retryAfter : 300);
      throw new ApiError(status, code, message, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }

    if (status === 401) {
      // The account was suspended, deleted, or its sessions were revoked.
      // Refreshing cannot help; the session is over.
      if (code === "auth/revoked") {
        onSessionEnded?.();
        throw new ApiError(status, code, message);
      }

      const config = error.config as Retryable | undefined;
      if (config && !config._retried && getToken) {
        config._retried = true;
        // The one place a forced refresh is correct.
        const fresh = await getToken(true);
        if (fresh) {
          config.headers.Authorization = `Bearer ${fresh}`;
          return api.request(config);
        }
        // No Firebase session behind the token at all.
        onSessionEnded?.();
      }
      throw new ApiError(status, code, message);
    }

    if (status === 429) {
      const retryAfter = Number(error.response?.headers?.["retry-after"]);
      throw new ApiError(
        status,
        code,
        message,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }

    throw new ApiError(status, code, message);
  },
);

export async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<T>(path, { params });
  return res.data;
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.post<T>(path, body);
  return res.data;
}

export async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.patch<T>(path, body);
  return res.data;
}

export async function del<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.delete<T>(path, { data: body });
  return res.data;
}

/**
 * Liveness check for the offline banner.
 *
 * Deliberately not on the `api` instance: it must not carry an Authorization
 * header, must not retry, and must fail fast. It also has to bypass the
 * `/api/v1` base, since health sits at the root.
 *
 * §5: the OS connectivity flag is not the question. It reports "connected" for
 * a captive portal, a dorm network that resolves DNS and nothing else, and a
 * phone holding a dead LTE association. The only honest answer to "am I online"
 * is a request that came back.
 */
export async function pingHealth(timeoutMs = 4000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/health`, {
        method: "HEAD",
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export { API_BASE, APP_VERSION };
