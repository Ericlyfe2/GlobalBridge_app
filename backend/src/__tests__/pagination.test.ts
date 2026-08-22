import { describe, it, expect } from "vitest";
import {
  paginationSchema,
  listEnvelope,
  totalFromWindow,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} from "../lib/pagination";

describe("paginationSchema", () => {
  it("coerces querystring values, which are always strings", () => {
    expect(paginationSchema.parse({ limit: "50", offset: "100" })).toEqual({
      limit: 50,
      offset: 100,
    });
  });

  it("defaults when absent", () => {
    expect(paginationSchema.parse({})).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  it("caps limit", () => {
    expect(() => paginationSchema.parse({ limit: String(MAX_LIMIT + 1) })).toThrow();
    expect(() => paginationSchema.parse({ limit: "100000" })).toThrow();
  });

  it("rejects a negative offset", () => {
    expect(() => paginationSchema.parse({ offset: "-1" })).toThrow();
  });

  it("rejects a fractional limit", () => {
    expect(() => paginationSchema.parse({ limit: "1.5" })).toThrow();
  });
});

describe("listEnvelope", () => {
  const page = { limit: 20, offset: 0 };

  it("reports hasMore from the real total, not from a full page", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    // Exactly one full page and nothing else: inferring from items.length would
    // say "more", and the client would fetch an empty page forever.
    expect(listEnvelope(items, 20, page).hasMore).toBe(false);
    expect(listEnvelope(items, 21, page).hasMore).toBe(true);
  });

  it("reports hasMore correctly on the last partial page", () => {
    const items = [1, 2, 3];
    expect(listEnvelope(items, 103, { limit: 20, offset: 100 }).hasMore).toBe(false);
    expect(listEnvelope(items, 150, { limit: 20, offset: 100 }).hasMore).toBe(true);
  });

  it("is empty and terminal when the filter matched nothing", () => {
    const env = listEnvelope([], 0, page);
    expect(env.items).toEqual([]);
    expect(env.total).toBe(0);
    expect(env.hasMore).toBe(false);
  });

  it("duplicates items under the legacy key without copying rows", () => {
    const items = [{ id: "a" }];
    const env = listEnvelope(items, 1, page, "listings");
    expect(env.listings).toBe(env.items);
  });
});

describe("totalFromWindow", () => {
  it("reads COUNT(*) OVER(), which pg returns as a string", () => {
    expect(totalFromWindow([{ total_count: "142" }])).toBe(142);
  });

  it("treats an empty page as a total of zero", () => {
    expect(totalFromWindow([])).toBe(0);
  });
});
