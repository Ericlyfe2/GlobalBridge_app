import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { pingHealth } from "../api/client";

/**
 * Are we actually reachable?
 *
 * ── Why the OS flag is not the answer ─────────────────────────────────────
 * `NetInfo.isConnected` reports "connected" for a captive portal that has not
 * been logged into, a dorm network that resolves DNS and routes nothing else,
 * and a phone holding an LTE association with no working backhaul. All three
 * are common for this audience — airport wifi on arrival day, university
 * networks with a sign-in page, a new SIM that has not provisioned data yet.
 *
 * The only honest answer is a request that came back. This hook asks the
 * server's `HEAD /health` and believes the result.
 *
 * ── Backoff ───────────────────────────────────────────────────────────────
 * 2s doubling to 30s while offline. A phone that has genuinely lost signal
 * should not be waking the radio every two seconds for the rest of the
 * afternoon — that is a measurable amount of someone's battery and, on a
 * metered plan, their money.
 */

const MIN_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 30_000;
/** While online, confirm occasionally rather than constantly. */
const HEALTHY_INTERVAL_MS = 60_000;

export type Connectivity = {
  online: boolean;
  /** True before the first probe resolves, so the UI can avoid flashing a banner. */
  checking: boolean;
  /** Force a probe now — used by a "Try again" button. */
  recheck: () => void;
};

export function useConnectivity(): Connectivity {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(true);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(MIN_INTERVAL_MS);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    const schedule = (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(probe, ms);
    };

    const probe = async () => {
      const reachable = await pingHealth();
      if (cancelled.current) return;

      setOnline(reachable);
      setChecking(false);

      if (reachable) {
        backoff.current = MIN_INTERVAL_MS;
        schedule(HEALTHY_INTERVAL_MS);
      } else {
        schedule(backoff.current);
        backoff.current = Math.min(backoff.current * 2, MAX_INTERVAL_MS);
      }
    };

    void probe();

    // Coming back to the foreground is the moment the answer is most likely to
    // have changed and most likely to be wrong — the socket died while
    // suspended and nothing told us.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        backoff.current = MIN_INTERVAL_MS;
        void probe();
      }
    });

    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
      subscription.remove();
    };
  }, []);

  return {
    online,
    checking,
    recheck: () => {
      backoff.current = MIN_INTERVAL_MS;
      void pingHealth().then((reachable) => {
        setOnline(reachable);
        setChecking(false);
      });
    },
  };
}
