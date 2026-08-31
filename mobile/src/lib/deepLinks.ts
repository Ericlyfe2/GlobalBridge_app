import { Alert } from "react-native";
import type { Router } from "expo-router";

/**
 * Resolves a server-issued deep link into a real screen.
 *
 * The backend's `routes` map (backend/src/lib/deep-links.ts) is documented as
 * "the canonical route map, shared by web and app" and emits web-shaped paths:
 * `/opportunities/:id`, `/messages/:id`, `/journey/roadmap`, `/bookings/:id`.
 * The mobile app is expo-router with flat screens and query params rather than
 * nested dynamic routes — `/opportunity-view?id=`, `/thread?id=`, `/journey` —
 * so a raw `router.push(deep_link)` silently lands on +not-found for almost
 * everything except `/` and `/notifications`, which happen to match by
 * coincidence. This is the one place that translates between the two.
 *
 * Every notification tap, home-screen alert, and next-deadline/next-session
 * card goes through here rather than pushing the server's string directly.
 */
export function openDeepLink(router: Router, path: string): void {
  const opportunity = path.match(/^\/opportunities\/([^/]+)$/);
  if (opportunity) {
    router.push({ pathname: "/opportunity-view", params: { id: opportunity[1] } } as never);
    return;
  }

  const conversation = path.match(/^\/messages\/([^/]+)$/);
  if (conversation) {
    // No `name` param available from a bare deep link; thread.tsx falls back
    // to "Conversation" in its header when one is absent.
    router.push({ pathname: "/thread", params: { id: conversation[1] } } as never);
    return;
  }

  const housing = path.match(/^\/housing\/([^/]+)$/);
  if (housing) {
    router.push({ pathname: "/housing-view", params: { id: housing[1] } } as never);
    return;
  }

  const document = path.match(/^\/documents\/([^/]+)$/);
  if (document) {
    // No `mime` available either, so document-view.tsx falls back to its
    // non-image "Open document" path rather than assuming an inline preview.
    router.push({ pathname: "/document-view", params: { id: document[1] } } as never);
    return;
  }

  if (path === "/journey/roadmap") {
    router.push("/journey" as never);
    return;
  }

  if (path === "/notifications") {
    router.push("/notifications" as never);
    return;
  }

  if (path === "/" || path === "") {
    router.push("/" as never);
    return;
  }

  // Flat mobile screens that already match a server path exactly, or that a
  // client-side caller (Home's own "finish your profile" action, for one)
  // passes in directly rather than through the server's `routes` map.
  const KNOWN_FLAT_ROUTES = new Set([
    "/profile",
    "/journey",
    "/assistant",
    "/explore",
    "/documents",
    "/messages",
    "/tools",
    "/scan",
  ]);
  if (KNOWN_FLAT_ROUTES.has(path)) {
    router.push(path as never);
    return;
  }

  // Mentor bookings, forum posts and safety alerts have no screen on mobile
  // yet. Saying so beats a push that lands on +not-found.
  Alert.alert("Not available in the app yet", "This is available on globalbridge.app.");
}
