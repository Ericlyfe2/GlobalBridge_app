import React from "react";
import { View } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Circle,
  Rect,
  Ellipse,
} from "react-native-svg";
import { useTheme } from "../theme/ThemeProvider";

const SvgEl = Svg as unknown as React.ElementType;
const DefsEl = Defs as unknown as React.ElementType;
const LinearGradientEl = LinearGradient as unknown as React.ElementType;
const StopEl = Stop as unknown as React.ElementType;
const PathEl = Path as unknown as React.ElementType;
const CircleEl = Circle as unknown as React.ElementType;
const RectEl = Rect as unknown as React.ElementType;
const EllipseEl = Ellipse as unknown as React.ElementType;

/**
 * The auth-screen hero: a flat travel-poster illustration (sky, sun, hills,
 * a signpost) filling a rounded-bottom panel above the form card.
 *
 * Built from SVG primitives rather than a bundled image so it repaints
 * correctly in both themes and never adds bytes to the release bundle --
 * relevant here, given how much of this session went into fighting bundle
 * staleness/size on the release build pipeline.
 */
export function AuthHero({ height = 260 }: { height?: number }) {
  const { colors, isDark } = useTheme();
  const w = 400;
  const h = 300;

  const skyTop = isDark ? colors.clay7 : "#7dd3e0";
  const skyBottom = isDark ? colors.clay6 : "#bce8ec";
  const sunColor = isDark ? colors.amber : "#ffd66b";
  const hillFar = isDark ? colors.clay6 : colors.leaf;
  const hillNear = isDark ? colors.clay : colors.clay;
  const ground = isDark ? colors.clay7 : colors.clay6;

  return (
    <View style={{ height, overflow: "hidden", borderBottomLeftRadius: 36, borderBottomRightRadius: 36 }}>
      <SvgEl width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMax slice">
        <DefsEl>
          <LinearGradientEl id="sky" x1="0" y1="0" x2="0" y2="1">
            <StopEl offset="0%" stopColor={skyTop} />
            <StopEl offset="100%" stopColor={skyBottom} />
          </LinearGradientEl>
        </DefsEl>

        <RectEl x={0} y={0} width={w} height={h} fill="url(#sky)" />

        {/* Sun */}
        <CircleEl cx={310} cy={70} r={38} fill={sunColor} opacity={0.9} />

        {/* Clouds */}
        <EllipseEl cx={80} cy={60} rx={34} ry={14} fill="#ffffff" opacity={0.55} />
        <EllipseEl cx={110} cy={52} rx={26} ry={12} fill="#ffffff" opacity={0.55} />

        {/* Far hills */}
        <PathEl d={`M0,180 Q100,120 200,170 T400,150 L400,${h} L0,${h} Z`} fill={hillFar} opacity={0.55} />

        {/* Near hills */}
        <PathEl d={`M0,220 Q120,150 240,210 T400,190 L400,${h} L0,${h} Z`} fill={hillNear} opacity={0.85} />

        {/* Ground strip */}
        <RectEl x={0} y={260} width={w} height={40} fill={ground} />

        {/* Signpost */}
        <RectEl x={196} y={150} width={8} height={110} rx={2} fill="#6b4a2f" />
        <RectEl x={150} y={150} width={70} height={24} rx={4} fill="#ffffff" opacity={0.92} />
        <RectEl x={158} y={182} width={58} height={20} rx={4} fill="#ffffff" opacity={0.85} />

        {/* Traveler silhouette */}
        <CircleEl cx={90} cy={196} r={12} fill="#3b2a2a" />
        <PathEl d="M78,208 Q90,202 102,208 L106,258 L96,258 L90,224 L84,258 L74,258 Z" fill="#3b2a2a" />
        <RectEl x={98} y={210} width={16} height={22} rx={4} fill={colors.clay6} />
      </SvgEl>
    </View>
  );
}
