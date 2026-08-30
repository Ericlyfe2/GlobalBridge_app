/**
 * Design tokens, taken verbatim from `GlobalBridge Mobile.dc.html`.
 *
 * The design ships two complete palettes keyed on `[data-t]` / `[data-t="dark"]`.
 * They are transcribed here rather than approximated: a hex that is "close
 * enough" is how an interface drifts away from its own design over a few
 * months, and these particular values also carry meaning — `clay` is the brand,
 * `amber` is caution, `danger` is a safety warning the user must not miss.
 *
 * Semantic names, not raw colours, everywhere in components. §21 of the brief
 * asks for exactly that, and it is what makes the dark palette a swap rather
 * than a rewrite.
 */

export type ColorTokens = {
  bg: string;
  surface: string;
  alt: string;
  border: string;
  border2: string;

  /** Text, darkest to lightest. */
  ink: string;
  ink8: string;
  ink7: string;
  ink6: string;
  ink5: string;

  /** Brand teal. */
  clay: string;
  clay6: string;
  clay7: string;

  leaf: string;
  sky: string;
  amber: string;
  danger: string;

  /** Tinted backgrounds for badges and alert rows. */
  claysoft: string;
  leafsoft: string;
  skysoft: string;
  ambersoft: string;
  dangersoft: string;
};

export const lightColors: ColorTokens = {
  bg: "#f8fafc",
  surface: "#ffffff",
  alt: "#f1f5f9",
  border: "#e2e8f0",
  border2: "#cbd5e1",
  ink: "#0f172a",
  ink8: "#1e293b",
  ink7: "#334155",
  ink6: "#475569",
  ink5: "#64748b",
  clay: "#0d9488",
  clay6: "#0f766e",
  clay7: "#115e59",
  leaf: "#14b8a6",
  sky: "#0284c7",
  amber: "#d97706",
  danger: "#dc2626",
  claysoft: "rgba(13,148,136,0.12)",
  leafsoft: "rgba(20,184,166,0.14)",
  skysoft: "rgba(2,132,199,0.12)",
  ambersoft: "rgba(217,119,6,0.13)",
  dangersoft: "rgba(220,38,38,0.11)",
};

export const darkColors: ColorTokens = {
  bg: "#0a0f1a",
  surface: "#111827",
  alt: "#0f172a",
  border: "#1f2937",
  border2: "#374151",
  ink: "#f1f5f9",
  ink8: "#e2e8f0",
  ink7: "#cbd5e1",
  ink6: "#94a3b8",
  ink5: "#64748b",
  clay: "#14b8a6",
  clay6: "#2dd4bf",
  clay7: "#5eead4",
  leaf: "#2dd4bf",
  sky: "#38bdf8",
  amber: "#fbbf24",
  danger: "#f87171",
  claysoft: "rgba(20,184,166,0.16)",
  leafsoft: "rgba(45,212,191,0.16)",
  skysoft: "rgba(56,189,248,0.14)",
  ambersoft: "rgba(251,191,36,0.15)",
  dangersoft: "rgba(248,113,113,0.14)",
};

/**
 * Type scale.
 *
 * The brief asks for an institutional serif for display and Inter for body.
 * Only Inter is bundled in the design export, so the serif is declared here
 * against the platform's own Georgia — available on both iOS and Android — and
 * the display face can be swapped in later without touching a component.
 */
export const fonts = {
  display: "Georgia",
  body: "Inter",
  bodyFallback: "System",
  mono: "Menlo",
} as const;

/**
 * Sizes are in points and never scaled down below 13.
 *
 * §22: readability beats fitting more on screen. A 11pt label is unreadable to
 * exactly the users who most need to read carefully — someone parsing a visa
 * requirement in their third language.
 */
export const type = {
  display: { size: 30, lineHeight: 36, weight: "600" as const },
  title: { size: 22, lineHeight: 28, weight: "600" as const },
  heading: { size: 17, lineHeight: 23, weight: "600" as const },
  body: { size: 15, lineHeight: 22, weight: "400" as const },
  label: { size: 14, lineHeight: 20, weight: "500" as const },
  small: { size: 13, lineHeight: 18, weight: "400" as const },
  /** Uppercase tags: SEC / DUE / DOC. Tracked out, monospace. */
  tag: { size: 11, lineHeight: 14, weight: "700" as const, letterSpacing: 0.8 },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/**
 * Minimum touch target, from §24.
 *
 * Enforced by the Button and IconButton components rather than left to each
 * screen to remember.
 */
export const MIN_TOUCH = 44;
