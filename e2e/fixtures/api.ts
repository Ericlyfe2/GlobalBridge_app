import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * A stubbed GlobalBridge API, installed as browser network routes.
 *
 * The app talks to the backend at http://localhost:4100 with axios; Playwright
 * intercepts those requests before they leave the browser, so the E2E suite
 * exercises the real screens against the documented response shapes without a
 * running backend. Payloads mirror the types in mobile/src/api/endpoints.ts.
 */

export type MockApiOptions = {
  /** Emails whose account exists but has no profile (404 on /auth/me). */
  freshEmails?: string[];
};

const PROFILE = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "student@globalbridge.test",
  full_name: "Student Test",
  role: "student",
  verification_status: null,
  avatar_url: null,
  country_of_origin: "Nigeria",
  country_of_residence: "United Kingdom",
  preferred_language: "en",
  timezone: "Europe/London",
  profile_completed_at: "2026-07-01T10:00:00.000Z",
};

const HOME = {
  user: {
    full_name: PROFILE.full_name,
    avatar_url: null,
    role: "student",
    country_of_origin: "Nigeria",
    country_of_residence: "United Kingdom",
    preferred_language: "en",
    timezone: "Europe/London",
    verification_status: null,
    profile_complete: true,
  },
  checklist: {
    id: "cl-1",
    destination_country: "United Kingdom",
    visa_type: "student",
    total: 8,
    completed: 3,
    percent: 38,
    href: "/journey",
  },
  next_deadline: {
    opportunity_id: "opp-1",
    title: "Chevening Scholarship",
    deadline: "2026-11-05T00:00:00Z",
    days_left: 5,
    href: "/opportunities?id=opp-1",
  },
  next_session: null,
  unread: { messages: 1, notifications: 0 },
  alerts: [],
  saved: [],
  opportunities: [
    {
      id: "opp-1",
      type: "scholarship",
      title: "Chevening Scholarship",
      country: "United Kingdom",
      deadline: "2026-11-05T00:00:00Z",
      funding_amount: "18000",
      currency: "GBP",
      is_verified: true,
    },
    {
      id: "opp-2",
      type: "scholarship",
      title: "Commonwealth Master's",
      country: "United Kingdom",
      deadline: "2027-01-15T00:00:00Z",
      funding_amount: null,
      currency: null,
      is_verified: false,
    },
  ],
};

const OPPORTUNITIES = {
  items: [
    {
      id: "opp-1",
      type: "scholarship",
      title: "Chevening Scholarship",
      institution: "UK Foreign Office",
      field_of_study: null,
      country: "United Kingdom",
      deadline: "2026-11-05T00:00:00Z",
      funding_amount: "18000",
      currency: "GBP",
      sponsors_visa: true,
      application_url: null,
      is_verified: true,
    },
    {
      id: "opp-2",
      type: "scholarship",
      title: "Commonwealth Master's",
      institution: null,
      field_of_study: null,
      country: "United Kingdom",
      deadline: "2027-01-15T00:00:00Z",
      funding_amount: null,
      currency: null,
      sponsors_visa: false,
      application_url: null,
      is_verified: false,
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
  hasMore: false,
};

const HOUSING = {
  items: [
    {
      id: "hsg-1",
      title: "Bright room in East London",
      city: "London",
      country: "United Kingdom",
      rent_amount: "850",
      currency: "GBP",
      rent_period: "month",
      bedrooms: 2,
      bathrooms: 1,
      furnished: true,
      photos: null,
      rating: "4.6",
      landlord_name: "Aisha",
      landlord_status: "verified",
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
  hasMore: false,
};

function bearerEmail(req: { headers: () => { [key: string]: string } }): string | null {
  const auth = req.headers()["authorization"] ?? "";
  const match = /Bearer e2e-token:(.+)$/.exec(auth);
  return match ? match[1] : null;
}

function json(route: { fulfill: (opts: object) => Promise<void> }, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Installs API routes. Must be called before any page navigation. */
export async function mockApi(page: Page, opts: MockApiOptions = {}) {
  const fresh = new Set(opts.freshEmails ?? []);
  const completed = new Set<string>();

  /** /auth/me returns 404 until onboarding registers the profile. */
  const isFresh = (email: string | null) => !!email && fresh.has(email) && !completed.has(email);

  const profileFor = (email: string) => ({
    ...PROFILE,
    email,
    full_name: email.startsWith("new@") ? "New Student" : PROFILE.full_name,
  });

  await page.route("**/health", (route) => route.fulfill({ status: 200, body: "ok" }));

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = route.request().method();
    const email = bearerEmail(route.request());

    switch (true) {
      case path === "/auth/me" && method === "GET": {
        // A fresh account has no profile row yet (404) so the app routes the
        // user to onboarding; completing onboarding marks it complete.
        if (isFresh(email)) {
          return json(route, { error: "No profile", code: "auth/profile-not-found" }, 404);
        }
        return json(route, { user: profileFor(email ?? PROFILE.email), profileComplete: true });
      }
      case path === "/auth/register-profile" && method === "POST": {
        if (email && fresh.has(email)) completed.add(email);
        return json(route, { user: profileFor(email ?? PROFILE.email), email: email ?? PROFILE.email });
      }
      case path === "/auth/preferences" && method === "PATCH":
        return json(route, { user: profileFor(email ?? PROFILE.email) });
      case path === "/home" && method === "GET":
        return json(route, HOME);
      case path === "/opportunities" && method === "GET":
        return json(route, OPPORTUNITIES);
      case path === "/housing" && method === "GET":
        return json(route, HOUSING);
      case path === "/users/device-tokens" && method === "DELETE":
        return json(route, { removed: 0 });
      default:
        // Loud failure so an un-stubbed call is never mistaken for a pass.
        return json(route, { error: "Not stubbed in E2E", code: "e2e/not-stubbed" }, 404);
    }
  });
}

/** Fire and accept the next native Alert (rendered as a browser dialog). */
export async function acceptDialog(page: Page): Promise<string> {
  const [dialog] = await Promise.all([page.waitForEvent("dialog"), page.waitForTimeout(0)]);
  const message = dialog.message();
  await dialog.accept();
  return message;
}

/** Complete the standard sign-in that every dashboard test starts from. */
export async function signIn(page: Page, email = "student@globalbridge.test", password = "password") {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByText("Your roadmap")).toBeVisible();
}

/** Tap one of the five bottom-tab destinations. */
export async function tapTab(page: Page, label: string) {
  const tab = page.getByRole("tab", { name: label, exact: true });
  if (await tab.count()) return tab.click();
  const button = page.getByRole("button", { name: label, exact: true }).first();
  if (await button.count()) return button.click();
  return page.getByText(label, { exact: true }).last().click();
}