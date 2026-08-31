import { expect, test } from "@playwright/test";

import { mockApi, signIn, tapTab } from "../fixtures/api";

test.describe("the five-tab app shell", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await signIn(page);
  });

  test("renders the home dashboard with the next action and roadmap", async ({ page }) => {
    await expect(page.getByText(/Good (morning|afternoon|evening), Student/)).toBeVisible();
    await expect(page.getByText("1 new message")).toBeVisible();
    await expect(page.getByText("Chevening Scholarship")).toBeVisible();
    await expect(page.getByText("Your roadmap")).toBeVisible();
    await expect(page.getByText("38%")).toBeVisible();
  });

  test("Explore lists funding and housing, and Jobs says it is not built yet", async ({ page }) => {
    await tapTab(page, "Explore");

    await expect(page.getByText("Explore", { exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder("Search funding and programmes")).toBeVisible();

    // Funding tab (default) with two opportunities.
    await expect(page.getByText("Chevening Scholarship", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Verified", { exact: true }).first()).toBeVisible();

    // Housing tab.
    await tapTab(page, "Housing");
    await expect(page.getByPlaceholder("Search city or listing")).toBeVisible();
    await expect(page.getByText("Bright room in East London")).toBeVisible();
    await expect(page.getByText("London, United Kingdom")).toBeVisible();

    // Jobs is declared unavailable rather than omitted.
    await tapTab(page, "Jobs");
    await expect(page.getByText("Jobs is not in this build yet")).toBeVisible();
  });

  test("Assistant renders its tool hub", async ({ page }) => {
    await tapTab(page, "Assistant");
    await expect(page.getByText("AI Visa Assistant")).toBeVisible();
  });

  test("Journey shows the live checklist from the same home payload", async ({ page }) => {
    await tapTab(page, "Journey");

    await expect(page.getByText("Your visa roadmap")).toBeVisible();
    await expect(page.getByText("student · United Kingdom")).toBeVisible();
    await expect(page.getByText("3 of 8 steps complete")).toBeVisible();
    await expect(page.getByText("Next deadline")).toBeVisible();
    await expect(page.getByText(/5 days left/)).toBeVisible();
  });

  test("Profile shows the signed-in account", async ({ page }) => {
    await tapTab(page, "Profile");

    await expect(page.getByText("student@globalbridge.test")).toBeVisible();
    await expect(page.getByText("Sign Out")).toBeVisible();
  });
});