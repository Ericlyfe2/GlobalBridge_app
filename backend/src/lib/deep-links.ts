/**
 * The canonical route map, shared by web and app.
 *
 * Every deep link the server emits -- push payloads, notification rows, share
 * targets -- is built here rather than string-concatenated at the call site.
 * That matters because these paths are also the web platform's URLs: when a
 * push notification and an email and an in-app tap disagree about where
 * "/messages/<id>" lives, the one that is wrong is whichever was written from
 * memory.
 *
 * Paths are emitted relative. The client resolves them against its own scheme
 * (globalbridge://) or the web origin; the server does not need to know which
 * of the two is asking.
 */

export const routes = {
  home: () => "/",
  opportunity: (id: string) => `/opportunities/${id}`,
  housing: (id: string) => `/housing/${id}`,
  conversation: (id: string) => `/messages/${id}`,
  mentor: (id: string) => `/mentors/${id}`,
  forumPost: (id: string) => `/forums/${id}`,
  booking: (id: string) => `/bookings/${id}`,
  document: (id: string) => `/documents/${id}`,
  roadmap: () => "/journey/roadmap",
  notifications: () => "/notifications",
  safetyAlert: (id: string) => `/safety/${id}`,
} as const;

export type RouteName = keyof typeof routes;

/**
 * Reject anything that is not one of our own relative paths before it reaches a
 * client as a deep link.
 *
 * A notification row is data, and data reaches this table from more than one
 * writer. A deep link that a client will open without a further prompt is not a
 * place to trust that every future writer remembered to use `routes` above --
 * an absolute URL landing here would turn an in-app tap into an open redirect.
 */
export function isSafeDeepLink(path: string): boolean {
  if (!path.startsWith("/")) return false;
  // "//host" is protocol-relative and resolves off-origin in a browser context.
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  return true;
}
