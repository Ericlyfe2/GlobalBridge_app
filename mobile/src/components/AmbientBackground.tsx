import React, { useMemo, useRef, useEffect } from "react";
import { Animated, Easing, StyleSheet, Dimensions } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useTheme } from "../theme/ThemeProvider";

const SvgEl = Svg as unknown as React.ElementType;
const CircleEl = Circle as unknown as React.ElementType;
const DefsEl = Defs as unknown as React.ElementType;
const RadialGradientEl = RadialGradient as unknown as React.ElementType;
const StopEl = Stop as unknown as React.ElementType;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

/**
 * A quiet, theme-aware backdrop for content screens: two slow-drifting glow
 * blobs and a handful of particles rising past them.
 *
 * Deliberately far less animation than AnimatedSplash -- this sits behind
 * text someone is reading, not a one-time intro, so it stays low-opacity,
 * slow, and non-blocking (`pointerEvents="none"`) rather than drawing the eye.
 */
export function AmbientBackground({ particleCount = 10 }: { particleCount?: number }) {
  const { colors, isDark } = useTheme();

  const drift1 = useRef(new Animated.Value(0)).current;
  const drift2 = useRef(new Animated.Value(0)).current;

  const particles = useMemo(
    () =>
      Array.from({ length: particleCount }).map(() => ({
        x: Math.random() * SCREEN_W,
        delay: Math.random() * 5000,
        duration: 6000 + Math.random() * 5000,
        size: 2 + Math.random() * 3,
        drift: (Math.random() - 0.5) * 30,
        value: new Animated.Value(0),
      })),
    [particleCount],
  );

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(drift1, {
          toValue: 1,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift1, {
          toValue: 0,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(drift2, {
          toValue: 1,
          duration: 11000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift2, {
          toValue: 0,
          duration: 11000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    particles.forEach((p) => {
      const loop = () => {
        p.value.setValue(0);
        Animated.timing(p.value, {
          toValue: 1,
          duration: p.duration,
          delay: p.delay,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(() => loop());
      };
      loop();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const glowOpacity = isDark ? 0.16 : 0.09;
  const particleColor = colors.clay;

  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [
              {
                translateY: drift1.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 40],
                }),
              },
              {
                translateX: drift1.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 24],
                }),
              },
            ],
          },
        ]}
      >
        <SvgEl width={SCREEN_W} height={SCREEN_H * 0.55}>
          <DefsEl>
            <RadialGradientEl id="ambientGlow1" cx="50%" cy="50%" r="55%">
              <StopEl offset="0%" stopColor={colors.clay} stopOpacity={glowOpacity} />
              <StopEl offset="100%" stopColor={colors.clay} stopOpacity={0} />
            </RadialGradientEl>
          </DefsEl>
          <CircleEl cx={SCREEN_W * 0.18} cy={SCREEN_H * 0.1} r={SCREEN_W * 0.5} fill="url(#ambientGlow1)" />
        </SvgEl>
      </Animated.View>

      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [
              {
                translateY: drift2.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -30],
                }),
              },
              {
                translateX: drift2.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -20],
                }),
              },
            ],
          },
        ]}
      >
        <SvgEl width={SCREEN_W} height={SCREEN_H * 0.6}>
          <DefsEl>
            <RadialGradientEl id="ambientGlow2" cx="50%" cy="50%" r="55%">
              <StopEl offset="0%" stopColor={colors.leaf} stopOpacity={glowOpacity} />
              <StopEl offset="100%" stopColor={colors.leaf} stopOpacity={0} />
            </RadialGradientEl>
          </DefsEl>
          <CircleEl cx={SCREEN_W * 0.86} cy={SCREEN_H * 0.42} r={SCREEN_W * 0.45} fill="url(#ambientGlow2)" />
        </SvgEl>
      </Animated.View>

      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: SCREEN_H * 0.9,
            width: p.size,
            height: p.size,
            borderRadius: p.size / 2,
            backgroundColor: particleColor,
            opacity: p.value.interpolate({
              inputRange: [0, 0.15, 0.85, 1],
              outputRange: [0, isDark ? 0.4 : 0.28, isDark ? 0.24 : 0.16, 0],
            }),
            transform: [
              {
                translateY: p.value.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -SCREEN_H * 0.75],
                }),
              },
              {
                translateX: p.value.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, p.drift],
                }),
              },
            ],
          }}
        />
      ))}
    </Animated.View>
  );
}
