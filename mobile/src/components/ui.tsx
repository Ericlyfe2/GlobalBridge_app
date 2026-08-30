import React from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { MIN_TOUCH } from "../theme/tokens";

/**
 * The shared component vocabulary, transcribed from the design.
 *
 * Everything here takes its colour from a semantic token, never a hex. That is
 * what makes the dark palette a swap instead of a second implementation, and it
 * is why a component never accepts a raw colour prop.
 */

// ── Text ──────────────────────────────────────────────────────────────────

type TextTone = "default" | "muted" | "subtle" | "brand" | "danger" | "warning" | "inverse";
type TextVariant = "display" | "title" | "heading" | "body" | "label" | "small" | "tag";

export function GBText({
  variant = "body",
  tone = "default",
  style,
  children,
  ...rest
}: {
  variant?: TextVariant;
  tone?: TextTone;
  style?: TextStyle | TextStyle[];
  children: React.ReactNode;
} & React.ComponentProps<typeof Text>) {
  const { colors, type, fonts } = useTheme();

  const toneColor: Record<TextTone, string> = {
    default: colors.ink,
    muted: colors.ink6,
    subtle: colors.ink5,
    brand: colors.clay6,
    danger: colors.danger,
    warning: colors.amber,
    inverse: "#ffffff",
  };

  const spec = type[variant];

  return (
    <Text
      {...rest}
      style={[
        {
          color: toneColor[tone],
          fontSize: spec.size,
          lineHeight: spec.lineHeight,
          fontWeight: spec.weight,
          fontFamily: variant === "display" ? fonts.display : undefined,
          ...(variant === "tag"
            ? { letterSpacing: type.tag.letterSpacing, textTransform: "uppercase" as const }
            : {}),
        },
        style as TextStyle,
      ]}
    >
      {children}
    </Text>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  onPress,
  accent,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  /** Left border tone, used by alert rows to carry priority. */
  accent?: string;
  accessibilityLabel?: string;
}) {
  const { colors, radius, space } = useTheme();

  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    ...(accent ? { borderLeftWidth: 3, borderLeftColor: accent } : {}),
  };

  if (!onPress) return <View style={[base, style]}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { opacity: 0.85 }, style]}
    >
      {children}
    </Pressable>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────

export type BadgeTone = "brand" | "info" | "warning" | "danger" | "neutral" | "success";

/**
 * A status chip.
 *
 * ── Never colour alone ────────────────────────────────────────────────────
 * §12 and §27 both require it, and the design's own notes say the same: the
 * shield icon carries verification, and the SEC / DUE / DOC tags carry alert
 * priority, so both survive greyscale and colour blindness. Hence `glyph` —
 * a badge without one is only allowed where the label itself is the meaning.
 */
export function Badge({
  label,
  tone = "neutral",
  glyph,
}: {
  label: string;
  tone?: BadgeTone;
  glyph?: string;
}) {
  const { colors, radius } = useTheme();

  const map: Record<BadgeTone, { fg: string; bg: string }> = {
    brand: { fg: colors.clay6, bg: colors.claysoft },
    success: { fg: colors.clay6, bg: colors.leafsoft },
    info: { fg: colors.sky, bg: colors.skysoft },
    warning: { fg: colors.amber, bg: colors.ambersoft },
    danger: { fg: colors.danger, bg: colors.dangersoft },
    neutral: { fg: colors.ink5, bg: colors.alt },
  };
  const { fg, bg } = map[tone];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        backgroundColor: bg,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.pill,
      }}
    >
      {glyph ? <GBText variant="tag" style={{ color: fg }}>{glyph}</GBText> : null}
      <GBText variant="tag" style={{ color: fg }}>
        {label}
      </GBText>
    </View>
  );
}

// ── Button ────────────────────────────────────────────────────────────────

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  /** Shown instead of a generic disabled state, so the reason is never a mystery. */
  unavailableReason,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  style?: ViewStyle;
}) {
  const { colors, radius, space } = useTheme();
  const isDisabled = Boolean(disabled || loading || unavailableReason);

  const palette = {
    primary: { bg: colors.clay, fg: "#ffffff", border: "transparent" },
    secondary: { bg: colors.surface, fg: colors.ink, border: colors.border2 },
    ghost: { bg: "transparent", fg: colors.clay6, border: "transparent" },
    danger: { bg: colors.danger, fg: "#ffffff", border: "transparent" },
  }[variant];

  return (
    <View>
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        accessibilityLabel={label}
        accessibilityHint={unavailableReason}
        style={({ pressed }) => [
          {
            minHeight: MIN_TOUCH,
            paddingHorizontal: space.lg,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: space.sm,
            backgroundColor: palette.bg,
            borderWidth: palette.border === "transparent" ? 0 : StyleSheet.hairlineWidth,
            borderColor: palette.border,
            opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
          },
          style,
        ]}
      >
        {loading ? <ActivityIndicator color={palette.fg} size="small" /> : null}
        <GBText variant="label" style={{ color: palette.fg }}>
          {label}
        </GBText>
      </Pressable>
      {unavailableReason ? (
        <GBText variant="small" tone="subtle" style={{ marginTop: 6 }}>
          {unavailableReason}
        </GBText>
      ) : null}
    </View>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────

export function ProgressBar({
  percent,
  color,
  label,
}: {
  percent: number;
  color?: string;
  label?: string;
}) {
  const { colors, radius } = useTheme();
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      accessibilityLabel={label}
    >
      <View
        style={{
          height: 6,
          borderRadius: radius.pill,
          backgroundColor: colors.alt,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${clamped}%`,
            height: "100%",
            borderRadius: radius.pill,
            backgroundColor: color ?? colors.clay,
          }}
        />
      </View>
    </View>
  );
}

// ── States ────────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const { space } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xxl, gap: space.sm }}>
      <GBText variant="heading">{title}</GBText>
      <GBText variant="body" tone="muted" style={{ textAlign: "center" }}>
        {body}
      </GBText>
      {action ? (
        <Button label={action.label} onPress={action.onPress} variant="secondary" style={{ marginTop: 8 }} />
      ) : null}
    </View>
  );
}

/**
 * Error state.
 *
 * §53: never an error code, never a stack trace, never "Network request
 * failed". The user is told what happened in words they can act on.
 */
export function ErrorState({
  title = "We could not load this",
  body = "Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  const { space } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xxl, gap: space.sm }}>
      <GBText variant="heading">{title}</GBText>
      <GBText variant="body" tone="muted" style={{ textAlign: "center" }}>
        {body}
      </GBText>
      {onRetry ? (
        <Button label="Try again" onPress={onRetry} variant="secondary" style={{ marginTop: 8 }} />
      ) : null}
    </View>
  );
}

/** Shimmer-free skeleton. Reduced-motion safe by construction. */
export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | `${number}%` }) {
  const { colors, radius } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, width, borderRadius: radius.sm, backgroundColor: colors.alt }}
    />
  );
}

/**
 * The stale-data banner.
 *
 * A labelled "showing saved data from 09:14" beats a spinner that never
 * resolves, and it is the difference between an app that is honest about being
 * offline and one that looks broken.
 */
export function StaleBanner({ at, online }: { at: number; online: boolean }) {
  const { colors, space, radius } = useTheme();
  if (online) return null;

  const time = new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        backgroundColor: colors.ambersoft,
        borderRadius: radius.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
      }}
    >
      <GBText variant="tag" style={{ color: colors.amber }}>
        OFFLINE
      </GBText>
      <GBText variant="small" tone="muted" style={{ flex: 1 }}>
        Showing saved data from {time}
      </GBText>
    </View>
  );
}
