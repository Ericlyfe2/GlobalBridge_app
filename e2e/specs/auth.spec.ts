import { expect, test } from "@playwright/test";

import { mockApi, signIn, acceptDialog, tapTab } from "../fixtures/api";

test.describe("authentication", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("boots to the login screen when signed out", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("GlobalBridge", { exact: true })).toBeVisible();
    await expect(page.getByText("Your immigration journey, simplified.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
  });

  test("rejects an empty submit with a clear message", async ({ page }) => {
    await page.goto("/login");
    const dialogPromise = page.waitForEvent("dialog");
    await page.getByRole("button", { name: "Sign In" }).click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("Please enter your email and password.");
    await dialog.accept();
  });

  test("explains that an unknown account does not exist", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("nobody@example.com");
    await page.getByPlaceholder("Password").fill("password");
    const dialogPromise = page.waitForEvent("dialog");
    await page.getByRole("button", { name: "Sign In" }).click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("No account exists with this email.");
    await dialog.accept();
    // Still on the login screen.
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("explains that a wrong password is wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("student@globalbridge.test");
    await page.getByPlaceholder("Password").fill("wrong-password");
    const dialogPromise = page.waitForEvent("dialog");
    await page.getByRole("button", { name: "Sign In" }).click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("Please check your password and try again.");
    await dialog.accept();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("signs an existing user in to the home screen", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("student@globalbridge.test");
    await page.getByPlaceholder("Password").fill("password");
    await page.getByRole("button", { name: "Sign In" }).click();

    // The single next action from the home payload.
    await expect(page.getByText("Chevening Scholarship")).toBeVisible();
    await expect(page.getByText(/5 days left/)).toBeVisible();
    // The roadmap card.
    await expect(page.getByText("Your roadmap")).toBeVisible();
    await expect(page.getByText("38%")).toBeVisible();
    // Unread copy.
    await expect(page.getByText("1 new message")).toBeVisible();
  });

  test("offers onboarding to an account with no profile, and completes it", async ({ page }) => {
    await mockApi(page, { freshEmails: ["new@globalbridge.test"] });
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("new@globalbridge.test");
    await page.getByPlaceholder("Password").fill("password");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Step 1 of 3.
    await expect(page.getByText("What should we call you?")).toBeVisible();
    await page.getByPlaceholder("Your full name").fill("Ada Johnson");
    await page.getByRole("button", { name: "I am moving to study" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2 of 3.
    await expect(page.getByText("Where are you moving?")).toBeVisible();
    await page.getByPlaceholder("Country").fill("Nigeria");
    await page.getByRole("radio", { name: "Canada" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3 of 3.
    await expect(page.getByText("Which language suits you?")).toBeVisible();
    await page.getByRole("radio", { name: "English" }).click();
    await page.getByRole("button", { name: "Finish" }).click();

    // Lands on the home tab of the app.
    await expect(page.getByText("Your roadmap")).toBeVisible();
    await expect(page.getByText("Ada Johnson", { exact: false })).toBeVisible();
  });

  test("requires a name before onboarding can advance", async ({ page }) => {
    await mockApi(page, { freshEmails: ["new@globalbridge.test"] });
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("new@globalbridge.test");
    await page.getByPlaceholder("Password").fill("password");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page.getByText("What should we call you?")).toBeVisible();
    const dialogPromise = page.waitForEvent("dialog");
    await page.getByRole("button", { name: "Continue" }).click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("It is the one thing we cannot skip");
    await dialog.accept();
    await expect(page.getByText("What should we call you?")).toBeVisible();
  });

  test("signs out from Profile back to the login screen", async ({ page }) => {
    await signIn(page);
    await tapTab(page, "Profile");

    await expect(page.getByText("student@globalbridge.test")).toBeVisible();

    const dialogPromise = page.waitForEvent("dialog");
    await page.getByText("Sign Out").click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("Are you sure?");
    await dialog.accept();

    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });
});