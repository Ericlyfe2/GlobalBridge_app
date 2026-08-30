/**
 * API types matching the backend contracts.
 *
 * These mirror the shapes the backend sends — not a shared package, because
 * mobile and backend are in separate repos. When the backend contract changes,
 * these types must change in the same commit.
 */

// ── Auth ──────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: "super_admin" | "admin" | "student" | "mentor" | "employer";
  verification_status: string | null;
  avatar_url: string | null;
  country_of_origin: string | null;
  country_of_residence: string | null;
  preferred_language: string | null;
  timezone: string | null;
  profile_completed_at: string | null;
  created_at: string;
};

// ── Home ──────────────────────────────────────────────────────────────────

export type HomeData = {
  user: {
    full_name: string;
    avatar_url: string | null;
    role: string;
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
  unread: {
    messages: number;
    notifications: number;
  };
  alerts: Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    deep_link: string;
    created_at: string;
  }>;
  saved: Array<{
    id: string;
    item_type: string;
    item_id: string;
    created_at: string;
  }>;
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

// ── Pagination ────────────────────────────────────────────────────────────

export type ListEnvelope<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

// ── Opportunities ─────────────────────────────────────────────────────────

export type Opportunity = {
  id: string;
  type: string;
  title: string;
  country: string;
  institution: string | null;
  field_of_study: string | null;
  funding_amount: string | null;
  currency: string | null;
  deadline: string | null;
  sponsors_visa: boolean;
  is_verified: boolean;
  application_url: string | null;
  created_at: string;
};

// ── Housing ───────────────────────────────────────────────────────────────

export type HousingListing = {
  id: string;
  title: string;
  city: string;
  country: string;
  rent_amount: number;
  currency: string;
  rent_period: string;
  bedrooms: number;
  bathrooms: number;
  furnished: boolean;
  photos: string[];
  rating: number;
  created_at: string;
  landlord_name: string;
  landlord_status: string;
};

// ── Messages ──────────────────────────────────────────────────────────────

export type Conversation = {
  id: string;
  last_message_at: string;
  created_at: string;
  other_user_id: string;
  other_user_name: string;
  other_user_avatar: string | null;
  last_message: string | null;
  unread_count: number;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

// ── Notifications ─────────────────────────────────────────────────────────

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  deep_link: string;
  data: Record<string, string> | null;
  read: boolean;
  locale: string;
  created_at: string;
};

// ── App Config ────────────────────────────────────────────────────────────

export type AppConfig = {
  minSupportedVersion: string;
  latestVersion: string;
  updateUrl: string;
  maintenanceMode: boolean;
  features: Record<string, boolean>;
  aiConfig: Record<string, { enabled: boolean; model: string | null }>;
  locales: readonly string[];
  websocketPath: string;
  minPollIntervalSeconds: number;
};

// ── Uploads ───────────────────────────────────────────────────────────────

export type UserDocument = {
  id: string;
  type: string;
  purpose: string;
  status: string;
  mime_type: string;
  size_bytes: number;
  original_filename: string | null;
  has_thumbnail: boolean;
  created_at: string;
  processed_at: string | null;
};

// ── Sync ──────────────────────────────────────────────────────────────────

export type SyncData = {
  cursor: string;
  has_more: boolean;
  full_resync: boolean;
  collections: {
    notifications: Notification[];
    messages: Message[];
    conversations: Conversation[];
    checklists: unknown[];
    saved_items: unknown[];
  };
  saved_item_ids: {
    complete: boolean;
    ids: string[];
  };
};
