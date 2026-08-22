import { describe, it, expect } from "vitest";
import { escapeLike } from "../lib/sanitize";
import { isSafeDeepLink, routes } from "../lib/deep-links";

describe("escapeLike", () => {
  it("escapes the LIKE wildcards", () => {
    // The bug: a literal % in a search box matches every row, so the filter
    // silently returns the whole table. It is not injection -- the value is
    // still bound -- which is why it survives review.
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("_")).toBe("\\_");
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes the escape character itself", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary search text alone", () => {
    expect(escapeLike("Toronto studio")).toBe("Toronto studio");
    expect(escapeLike("café")).toBe("café");
  });

  it("does not mangle text a user would plausibly search for", () => {
    // Quotes and apostrophes are not LIKE metacharacters and must survive
    // untouched -- they are bound parameters, not string-concatenated SQL.
    expect(escapeLike("O'Brien")).toBe("O'Brien");
    expect(escapeLike('say "hi"')).toBe('say "hi"');
  });
});

describe("deep links", () => {
  it("builds canonical paths shared with the web platform", () => {
    expect(routes.conversation("abc")).toBe("/messages/abc");
    expect(routes.housing("abc")).toBe("/housing/abc");
    expect(routes.opportunity("abc")).toBe("/opportunities/abc");
  });

  it("accepts our own relative paths", () => {
    expect(isSafeDeepLink("/messages/abc")).toBe(true);
    expect(isSafeDeepLink("/")).toBe(true);
  });

  it("refuses anything that could redirect off-origin", () => {
    // A deep link is opened without a further prompt. An absolute or
    // protocol-relative URL landing in a notification row would turn an in-app
    // tap into an open redirect.
    expect(isSafeDeepLink("https://evil.example.com")).toBe(false);
    expect(isSafeDeepLink("//evil.example.com")).toBe(false);
    expect(isSafeDeepLink("javascript:alert(1)")).toBe(false);
    expect(isSafeDeepLink("messages/abc")).toBe(false);
    expect(isSafeDeepLink("/messages\\..\\admin")).toBe(false);
  });
});
