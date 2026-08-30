import React from "react";
import Svg, { Path } from "react-native-svg";

/**
 * The navigation icons, as SVG paths lifted verbatim from the design.
 *
 * Drawn rather than pulled from an icon font because they are drawn in the
 * design: the `journey` glyph in particular is a bridge, which is the product's
 * central metaphor and has no equivalent in any icon set. Substituting a
 * generic "map" icon would quietly discard the one mark that means something.
 *
 * Stroke weight carries the active state alongside colour, so selection
 * survives greyscale — §27's rule that information must never be colour alone
 * applies to navigation as much as to badges.
 */
export const ICON_PATHS = {
  home: "M3 10.4 12 3.4l9 7v9.2a1.4 1.4 0 0 1-1.4 1.4h-4.2v-6.6H9.6V21H5.4A1.4 1.4 0 0 1 4 19.6v-9.2Z",
  explore: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM20 20l-3.9-3.9",
  assistant:
    "M12 3.2 12 5M7.6 7.6h8.8a2 2 0 0 1 2 2v6.2a2 2 0 0 1-2 2H7.6a2 2 0 0 1-2-2V9.6a2 2 0 0 1 2-2ZM9.6 12.4v1.4M14.4 12.4v1.4",
  journey:
    "M6 20V9.4a3.4 3.4 0 0 1 6.8 0V15a3.4 3.4 0 0 0 6.8 0V4M6 20l-2-2.4M6 20l2-2.4M19.6 4l-2 2.2M19.6 4l2 2.2",
  profile: "M12 12.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4ZM4.6 21a7.4 7.4 0 0 1 14.8 0",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  color,
  size = 24,
  active = false,
}: {
  name: IconName;
  color: string;
  size?: number;
  active?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={ICON_PATHS[name]}
        stroke={color}
        strokeWidth={active ? 2.4 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
