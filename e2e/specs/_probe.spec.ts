import { expect, test } from "@playwright/test";
import { mockApi } from "../fixtures/api";

test("probe: boot + dialog flow", async ({ page }) => {
  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text().slice(0, 300)));
  page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 500)));

  await mockApi(page);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  console.log("[url]", page.url());
  console.log("[title]", await page.title());
  const text = await page.locator("body").innerText();
  console.log("[body-start]", JSON.stringify(text.slice(0, 600)));
});