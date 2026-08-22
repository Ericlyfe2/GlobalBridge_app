import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, isBelowMinimum } from "../lib/version";

describe("parseVersion", () => {
  it("parses a plain release", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
  });

  it("parses a prerelease and ignores build metadata", () => {
    expect(parseVersion("1.2.3-beta.1+sha.abc")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: "beta.1",
    });
  });

  it("rejects things that are not versions", () => {
    for (const bad of ["", "1.2", "v1.2.3", "1.2.3.4", "latest", "1.2.x", "-1.0.0"]) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  const cmp = (a: string, b: string) => compareVersions(parseVersion(a)!, parseVersion(b)!);

  it("orders by major, then minor, then patch", () => {
    expect(cmp("2.0.0", "1.9.9")).toBe(1);
    expect(cmp("1.3.0", "1.2.9")).toBe(1);
    expect(cmp("1.2.4", "1.2.3")).toBe(1);
    expect(cmp("1.2.3", "1.2.3")).toBe(0);
  });

  it("compares numerically, not lexically", () => {
    // The bug this guards: "10" < "9" as strings.
    expect(cmp("1.10.0", "1.9.0")).toBe(1);
    expect(cmp("10.0.0", "9.0.0")).toBe(1);
  });

  it("sorts a prerelease below its own release", () => {
    expect(cmp("1.2.0-beta.1", "1.2.0")).toBe(-1);
    expect(cmp("1.2.0", "1.2.0-beta.1")).toBe(1);
  });
});

describe("isBelowMinimum", () => {
  it("refuses builds older than the floor", () => {
    expect(isBelowMinimum("1.1.9", "1.2.0")).toBe(true);
    expect(isBelowMinimum("0.9.0", "1.2.0")).toBe(true);
  });

  it("accepts the floor itself and anything newer", () => {
    expect(isBelowMinimum("1.2.0", "1.2.0")).toBe(false);
    expect(isBelowMinimum("1.2.1", "1.2.0")).toBe(false);
    expect(isBelowMinimum("2.0.0", "1.2.0")).toBe(false);
  });

  it("treats a prerelease of the floor version as below it", () => {
    // A beta of the release that fixed a breaking change does not necessarily
    // contain the fix.
    expect(isBelowMinimum("1.2.0-rc.1", "1.2.0")).toBe(true);
  });

  it("does not refuse unparseable input", () => {
    // An unparseable version is a client bug, and telling the user to update
    // would be advice that does not fix it.
    expect(isBelowMinimum("garbage", "1.2.0")).toBe(false);
    expect(isBelowMinimum("1.2.0", "garbage")).toBe(false);
  });
});
