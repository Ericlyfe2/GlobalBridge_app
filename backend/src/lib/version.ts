/**
 * Semver comparison, narrow on purpose.
 *
 * The only question this service asks about a version is "is this build older
 * than the minimum we still support", and the only versions it ever sees are
 * the ones our own release process produces. Pulling in a full semver parser to
 * answer that would import range syntax, prerelease precedence rules and
 * coercion behaviour that nothing here wants and that would quietly change what
 * "supported" means.
 *
 * Prerelease suffixes are compared by presence only: 1.2.0-beta.1 sorts *below*
 * 1.2.0, which is the semver rule and also the behaviour we want -- a beta of
 * the version that fixed a breaking change has not necessarily got the fix.
 */

export type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string | null };

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,64}))?(?:\+[0-9A-Za-z.-]{1,64})?$/;

export function parseVersion(raw: string): ParsedVersion | null {
  const m = VERSION_RE.exec(raw.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  // Equal release numbers: a prerelease is older than the release itself.
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** True when `version` is strictly older than `minimum`. Unparseable input is not "below". */
export function isBelowMinimum(version: string, minimum: string): boolean {
  const v = parseVersion(version);
  const min = parseVersion(minimum);
  if (!v || !min) return false;
  return compareVersions(v, min) < 0;
}
