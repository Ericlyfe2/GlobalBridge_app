import { get, post, patch, del } from "./client";

/**
 * Typed calls against the GlobalBridge mobile API.
 *
 * One function per endpoint, named for what the screen wants rather than for
 * the HTTP verb. Screens import from here and never build a path by hand — a
 * path assembled at a call site is how `/api/messages` and `/api/v1/messages`
 * end up both in use.
 *
 * Shapes mirror the server's responses exactly. Where the server sends a
 * pagination envelope, the envelope is preserved: `hasMore` is computed there
 * from a real count, and recomputing it here from `items.length` would
 * reintroduce the bug the envelope exists to prevent.
 */

// ── Shared shapes ──────────────────────────────────────────────────────────

export type ListEnvelope<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type Role = "student" | "mentor" | "employer" | "admin" | "super_admin";

// ── App config: the one cold-start call ───────────────────────────────────

export type AppConfig = {
  minSupportedVersion: string;
  latestVersion: string;
  updateUrl: string;
  maintenanceMode: boolean;
  features: Record<string, boolean>;
  aiConfig: Record<string, { enabled: boolean; model: string | null }>;
  locales: string[];
  websocketPath: string;
  minPollIntervalSeconds: number;
};

export const fetchAppConfig = () => get<AppConfig>("/app-config");

// ── Auth ──────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  verification_status: string | null;
  avatar_url: string | null;
  country_of_origin: string | null;
  country_of_residence: string | null;
  preferred_language: string | null;
  timezone: string | null;
  profile_completed_at: string | null;
};

export const registerProfile = (body: {
  full_name: string;
  role?: "student" | "mentor" | "employer";
  country_of_origin?: string;
  country_of_residence?: string;
  preferred_language?: string;
  timezone?: string;
}) => post<{ user: Profile; email: string }>("/auth/register-profile", body);

export const fetchMe = () => get<{ user: Profile; profileComplete: boolean }>("/auth/me");

export const updatePreferences = (body: {
  preferred_language?: string;
  timezone?: string;
  share_country_of_origin?: boolean;
}) => patch<{ user: Partial<Profile> }>("/auth/preferences", body);

// ── Home: the whole first screen in one request ───────────────────────────

export type HomePayload = {
  user: {
    full_name: string;
    avatar_url: string | null;
    role: Role;
    country_of_origin: string | null;
    country_of_residence: string | null;
    preferred_language: string | null;
    timezone: string | null;
    verification_status: string | null;
    profile_complete: boolean;
  };
  checklist: {
    id: string;
    destination_country: string;
    visa_type: string;
    total: number;
    completed: number;
    percent: number;
    href: string;
  } | null;
  next_deadline: {
    opportunity_id: string;
    title: string;
    deadline: string;
    days_left: number;
    href: string;
  } | null;
  next_session: {
    booking_id: string;
    starts_at: string;
    with_name: string;
    viewer_is_mentor: boolean;
    href: string;
  } | null;
  unread: { messages: number; notifications: number };
  alerts: Array<{
    id: string;
    kind: string;
    title: string;
    body: string | null;
    deep_link: string | null;
    created_at: string;
  }>;
  saved: Array<{ id: string; item_type: string; item_id: string; created_at: string }>;
  opportunities: Array<{
    id: string;
    type: string;
    title: string;
    country: string;
    deadline: string | null;
    funding_amount: string | null;
    currency: string | null;
    is_verified: boolean;
  }>;
};

export const fetchHome = () => get<HomePayload>("/home");

// ── Discovery ─────────────────────────────────────────────────────────────

export type Opportunity = HomePayload["opportunities"][number] & {
  institution?: string | null;
  field_of_study?: string | null;
  sponsors_visa?: boolean;
  application_url?: string | null;
};

export const fetchOpportunities = (params: {
  limit?: number;
  offset?: number;
  q?: string;
  country?: string;
  type?: string;
  sponsors_visa?: boolean;
  verified_only?: boolean;
}) => get<ListEnvelope<Opportunity>>("/opportunities", params);

export type HousingListing = {
  id: string;
  title: string;
  city: string;
  country: string;
  rent_amount: string;
  currency: string;
  rent_period: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  furnished: boolean;
  photos: string[] | null;
  rating: string | null;
  landlord_name: string;
  landlord_status: string;
};

export const fetchHousing = (params: {
  limit?: number;
  offset?: number;
  q?: string;
  city?: string;
  country?: string;
  furnished?: boolean;
}) => get<ListEnvelope<HousingListing>>("/housing", params);

// ── Messages ──────────────────────────────────────────────────────────────

export type Conversation = {
  id: string;
  last_message_at: string;
  other_user_id: string;
  other_user_name: string;
  other_user_avatar: string | null;
  last_message: string | null;
  unread_count: string;
};

export const fetchConversations = (params: { limit?: number; offset?: number } = {}) =>
  get<ListEnvelope<Conversation>>("/messages", params);

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

export const fetchMessages = (
  conversationId: string,
  params: { limit?: number; offset?: number } = {},
) => get<ListEnvelope<Message>>(`/messages/${conversationId}`, params);

export const sendMessage = (
  conversationId: string,
  body: string,
  clientMessageId: string,
) =>
  post<{ message: Message; deduplicated?: boolean }>(`/messages/${conversationId}`, {
    body,
    client_message_id: clientMessageId,
  });

/** Missed-message replay after the socket was down. */
export const fetchMessagesSince = (cursor?: string, limit = 100) =>
  get<{ items: Message[]; cursor: string; hasMore: boolean }>("/messages/since", {
    cursor,
    limit,
  });

// ── Notifications ─────────────────────────────────────────────────────────

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  deep_link: string | null;
  data: Record<string, string> | null;
  read: boolean;
  locale: string;
  created_at: string;
};

export const fetchNotifications = (params: { limit?: number; offset?: number } = {}) =>
  get<ListEnvelope<Notification>>("/content/notifications", params);

export const fetchUnreadCount = () =>
  get<{ unread: number }>("/content/notifications/unread-count");

export const markNotificationsRead = (ids?: string[]) =>
  post<{ updated: number }>("/content/notifications/read", ids ? { ids } : {});

// ── AI ────────────────────────────────────────────────────────────────────

export type AiSource = {
  title: string;
  url: string;
  confidence: "verified" | "knowledge_base" | "web";
};

export type ChatReply = {
  reply: string;
  sources: AiSource[];
  lang: string;
  conversation_id: string | null;
  retrieval?: string;
  degraded?: boolean;
};

export const sendChat = (body: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  lang?: string;
  conversation_id?: string;
}) => post<ChatReply>("/ai/chat", body);

export type ScamResult = {
  score: number;
  verdict: "Likely safe" | "Be cautious" | "High scam risk";
  summary: string;
  flags: Array<{
    phrase: string;
    category: string;
    why: string;
    severity: "low" | "med" | "high";
  }>;
  advice: string[];
  /** Set when the check ran without the model. Never presented as a clean result. */
  degraded?: boolean;
  /** Set when an admin switched the tool off. */
  disabled?: boolean;
};

export const checkScam = (text: string, kind?: string) =>
  post<ScamResult>("/ai/scam-check", { text, kind });

export type DocCheckResult = {
  score: number;
  label: "Looks great" | "Review warnings" | "Needs fixes";
  summary: string;
  findings: Array<{
    id: string;
    label: string;
    detail: string;
    severity: "ok" | "warn" | "fail";
  }>;
  degraded?: boolean;
  disabled?: boolean;
};

export const checkDocument = (body: {
  docType: string;
  fileName?: string;
  fileSize?: number;
  notes?: string;
  meta?: { name?: string; expiry?: string; country?: string };
}) => post<DocCheckResult>("/ai/doc-check", body);

export type AiStatus = {
  configured: boolean;
  model: string;
  features: Record<string, boolean>;
  degraded: boolean;
};

export const fetchAiStatus = () => get<AiStatus>("/ai/status");

export const fetchAiUsage = () =>
  get<{
    spent_usd: number;
    limit_usd: number;
    exceeded: boolean;
    calls: number;
    resets_at: string;
  }>("/ai/usage/today");

// ── Device tokens ─────────────────────────────────────────────────────────

export const registerDeviceToken = (body: {
  token: string;
  platform: "ios" | "android";
  app_version?: string;
  locale?: string;
}) => post<{ id: string; registered: boolean }>("/users/device-tokens", body);

/**
 * Called on sign-out, before the Firebase session is torn down — this endpoint
 * needs a valid token to know whose mapping to remove.
 *
 * Not optional. An FCM token belongs to an install, not a person: left mapped
 * to the previous user, the next person to sign in on a shared phone receives
 * their message previews and security alerts on the lock screen.
 */
export const unregisterDeviceToken = (token: string) =>
  del<{ removed: number }>("/users/device-tokens", { token });

// ── Uploads ───────────────────────────────────────────────────────────────

export type PresignResponse = {
  document_id: string;
  upload_url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_in: number;
  max_bytes: number;
};

export const presignUpload = (body: {
  type: string;
  purpose: "document" | "avatar" | "housing_photo";
  content_type: string;
  size_bytes: number;
  filename?: string;
}) => post<PresignResponse>("/uploads/presign", body);

export const completeUpload = (documentId: string) =>
  post<{
    document: Record<string, unknown>;
    metadata_stripped: boolean;
    dimensions: { width: number | null; height: number | null };
  }>(`/uploads/${documentId}/complete`, {});

export type UserDocument = {
  id: string;
  type: string;
  purpose: string;
  status: "pending" | "ready" | "rejected";
  mime_type: string | null;
  size_bytes: string | null;
  original_filename: string | null;
  verified: boolean;
  rejected_reason: string | null;
  created_at: string;
  has_thumbnail: boolean;
};

export const fetchDocuments = (params: { limit?: number; offset?: number } = {}) =>
  get<ListEnvelope<UserDocument>>("/uploads", params);

/** A short-lived signed URL. Never cached — see the server's no-store header. */
export const fetchDocumentUrl = (id: string, thumbnail = false) =>
  get<{ url: string; expires_in: number }>(`/uploads/${id}`, thumbnail ? { thumbnail: 1 } : {});

export const deleteDocument = (id: string) => del<{ deleted: boolean }>(`/uploads/${id}`);

export const fetchUploadStatus = () =>
  get<{
    available: boolean;
    max_bytes: number;
    quota_bytes: number;
    used_bytes: number;
    accepted_types: string[];
  }>("/uploads/meta/status");

// ── Sync ──────────────────────────────────────────────────────────────────

export const fetchSync = (since?: string, limit = 100) =>
  get<{
    cursor: string;
    has_more: boolean;
    full_resync: boolean;
    collections: {
      notifications: Notification[];
      messages: Message[];
      conversations: Conversation[];
      checklists: Array<Record<string, unknown>>;
      saved_items: Array<{ id: string; item_type: string; item_id: string }>;
    };
    saved_item_ids: { complete: boolean; ids: string[] };
  }>("/sync", { since, limit });
