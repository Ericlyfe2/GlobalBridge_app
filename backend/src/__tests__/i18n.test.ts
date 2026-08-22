import { describe, it, expect } from "vitest";
import { normalizeLocale, t, hasTranslation, SUPPORTED_LOCALES, RTL_LOCALES } from "../lib/i18n";

describe("normalizeLocale", () => {
  it("accepts the supported set", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(normalizeLocale(locale)).toBe(locale);
    }
  });

  it("matches on the language subtag", () => {
    expect(normalizeLocale("pt-BR")).toBe("pt");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh");
    expect(normalizeLocale("ar_EG")).toBe("ar");
    expect(normalizeLocale("EN-GB")).toBe("en");
  });

  it("falls back to English rather than failing", () => {
    expect(normalizeLocale("kl")).toBe("en");
    expect(normalizeLocale("")).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
  });

  it("covers all 14 product locales, with Arabic marked RTL", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(14);
    expect(RTL_LOCALES.has("ar")).toBe(true);
  });
});

describe("t", () => {
  it("interpolates named variables", () => {
    expect(t("en", "notification.message.title", { name: "Amara" })).toBe(
      "New message from Amara",
    );
  });

  it("translates when the locale has the string", () => {
    expect(t("fr", "notification.security.title")).toBe("Alerte de sécurité");
    expect(t("ar", "notification.security.title")).toBe("تنبيه أمني");
  });

  it("falls back per key, not per locale", () => {
    // German has no catalog yet. A half-translated locale is normal mid-rollout;
    // a blank lock screen is not.
    expect(t("de", "notification.security.title")).toBe("Security alert");
  });

  it("leaves an unknown placeholder intact rather than blanking it", () => {
    expect(t("en", "notification.message.title", {})).toBe("New message from {name}");
  });

  it("does not let an interpolated value rewrite the template", () => {
    // A display name is user-supplied. If substitution recursed, a name of
    // "{name}" or "{time}" could rewrite the sentence around it.
    const out = t("en", "notification.booking.body", { name: "{time}", time: "3:00 PM" });
    expect(out).toBe("Your session with {time} starts at 3:00 PM.");
  });

  it("returns the key when nothing anywhere defines it", () => {
    expect(t("en", "notification.nonexistent")).toBe("notification.nonexistent");
  });
});

describe("hasTranslation", () => {
  it("distinguishes a real translation from a fallback", () => {
    expect(hasTranslation("fr", "notification.security.title")).toBe(true);
    expect(hasTranslation("de", "notification.security.title")).toBe(false);
  });
});
