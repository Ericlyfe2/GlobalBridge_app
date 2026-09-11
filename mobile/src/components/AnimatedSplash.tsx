import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, Dimensions } from "react-native";
import Svg, { Path, Circle, Defs, RadialGradient, Stop } from "react-native-svg";

/**
 * react-native-svg 15.x ships pre-React-19 class types that fail the React 19
 * JSX checker under @types/react 19 -- see Icon.tsx. Runtime is unaffected.
 */
const SvgEl = Svg as unknown as React.ElementType;
const PathEl = Path as unknown as React.ElementType;
const CircleEl = Circle as unknown as React.ElementType;
const DefsEl = Defs as unknown as React.ElementType;
const RadialGradientEl = RadialGradient as unknown as React.ElementType;
const StopEl = Stop as unknown as React.ElementType;
const AnimatedPath = Animated.createAnimatedComponent(PathEl as React.ComponentType<any>);

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const WORDMARK = "GlobalBridge";
const TAGLINE = "Your immigration journey, simplified.";

/**
 * The intro splash.
 *
 * Replaces the plain "loading" spinner the Gate used to show while
 * `checkAppConfig`/`checkSession` resolve. It is choreographed, not just
 * decorative: the bridge is the product's own icon (see Icon.tsx's `journey`
 * glyph) drawn large and built stroke-by-stroke, because that is the one
 * motif that means something here.
 *
 * `minDurationMs` guarantees the sequence never feels cut short on a fast
 * connection; `ready` (auth no longer "loading") extends it if the network is
 * slow, rather than racing the last animation frame against a real fetch.
 */
export function AnimatedSplash({
  ready,
  onFinish,
  minDurationMs = 2400,
}: {
  ready: boolean;
  onFinish: () => void;
  minDurationMs?: number;
}) {
  const [visible, setVisible] = useState(true);

  const glow = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const towerL = useRef(new Animated.Value(0)).current;
  const towerR = useRef(new Animated.Value(0)).current;
  const cableDraw = useRef(new Animated.Value(0)).current;
  const deckDraw = useRef(new Animated.Value(0)).current;
  const suspenders = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.72)).current;
  const iconSettle = useRef(new Animated.Value(0)).current;
  const shimmerX = useRef(new Animated.Value(-1)).current;
  const taglineY = useRef(new Animated.Value(10)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const exitScale = useRef(new Animated.Value(1)).current;

  const letterAnims = useMemo(
    () => WORDMARK.split("").map(() => new Animated.Value(0)),
    [],
  );

  const particles = useMemo(
    () =>
      Array.from({ length: 16 }).map(() => ({
        x: Math.random() * SCREEN_W,
        delay: Math.random() * 2600,
        duration: 3200 + Math.random() * 2600,
        size: 2 + Math.random() * 3.5,
        drift: (Math.random() - 0.5) * 40,
        value: new Animated.Value(0),
      })),
    [],
  );

  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    // Ambient background glow: fade in, then breathe for the whole splash.
    Animated.timing(glow, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 1,
          duration: 1900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0,
          duration: 1900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    // Particles: independent, looping, staggered by random delay.
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

    // The bridge builds itself: towers rise, cable and deck draw in, then the
    // whole mark settles with a small overshoot bounce.
    Animated.sequence([
      Animated.delay(150),
      Animated.parallel([
        Animated.timing(towerL, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(towerR, {
          toValue: 1,
          duration: 420,
          delay: 90,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(iconScale, {
          toValue: 1,
          duration: 620,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(cableDraw, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(deckDraw, {
          toValue: 1,
          duration: 420,
          delay: 120,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
      Animated.timing(suspenders, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(iconSettle, {
        toValue: 1,
        friction: 4.5,
        tension: 60,
        useNativeDriver: true,
      }),
      // Wordmark: letters stagger in.
      Animated.stagger(
        38,
        letterAnims.map((v) =>
          Animated.spring(v, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
        ),
      ),
      // A single light sweep across the finished wordmark.
      Animated.timing(shimmerX, {
        toValue: 1,
        duration: 650,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(taglineY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // A deliberate beat so the finished wordmark is actually seen, not just
      // assembled and immediately faded.
      Animated.delay(750),
    ]).start(() => {
      const waitForReady = () => {
        if (readyRef.current) {
          Animated.parallel([
            Animated.timing(exitOpacity, {
              toValue: 0,
              duration: 480,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(exitScale, {
              toValue: 1.06,
              duration: 480,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
          ]).start(() => {
            setVisible(false);
            onFinish();
          });
        } else {
          setTimeout(waitForReady, 80);
        }
      };
      waitForReady();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The minimum-duration guard lives in `ready` itself via the parent, but we
  // also honor an explicit floor so a fast-resolving auth check can't cut the
  // choreography off mid-stroke.
  const [floorPassed, setFloorPassed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFloorPassed(true), minDurationMs);
    return () => clearTimeout(t);
  }, [minDurationMs]);
  readyRef.current = ready && floorPassed;

  if (!visible) return null;

  const cableLength = 340;
  const deckLength = 220;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        { opacity: exitOpacity, transform: [{ scale: exitScale }] },
      ]}
    >
      {/* Ambient glow */}
      <Animated.View
        style={[
          styles.glowWrap,
          {
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
          },
        ]}
      >
        <SvgEl width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
          <DefsEl>
            <RadialGradientEl id="glow" cx="50%" cy="42%" r="55%">
              <StopEl offset="0%" stopColor="#14b8a6" stopOpacity={0.34} />
              <StopEl offset="45%" stopColor="#0d9488" stopOpacity={0.14} />
              <StopEl offset="100%" stopColor="#0a0f1a" stopOpacity={0} />
            </RadialGradientEl>
          </DefsEl>
          <CircleEl cx={SCREEN_W / 2} cy={SCREEN_H * 0.42} r={SCREEN_W * 0.7} fill="url(#glow)" />
        </SvgEl>
      </Animated.View>

      <Animated.View
        style={[
          styles.glowWrap,
          {
            opacity: glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
            transform: [
              { scale: glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.05] }) },
            ],
          },
        ]}
      >
        <SvgEl width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
          <CircleEl
            cx={SCREEN_W / 2}
            cy={SCREEN_H * 0.42}
            r={SCREEN_W * 0.32}
            fill="#14b8a6"
            opacity={0.06}
          />
        </SvgEl>
      </Animated.View>

      {/* Floating particles */}
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: SCREEN_H * 0.78,
            width: p.size,
            height: p.size,
            borderRadius: p.size / 2,
            backgroundColor: "#2dd4bf",
            opacity: p.value.interpolate({
              inputRange: [0, 0.15, 0.85, 1],
              outputRange: [0, 0.85, 0.5, 0],
            }),
            transform: [
              {
                translateY: p.value.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -SCREEN_H * 0.62],
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

      {/* Bridge mark */}
      <View style={styles.center}>
        <Animated.View
          style={{
            transform: [
              { scale: iconScale },
              {
                translateY: iconSettle.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0, -6, 0],
                }),
              },
            ],
          }}
        >
          <SvgEl width={168} height={104} viewBox="0 0 240 140">
            {/* Towers -- rise from the deck line upward */}
            <AnimatedPath
              d="M74 118 L74 26"
              stroke="#2dd4bf"
              strokeWidth={7}
              strokeLinecap="round"
              strokeDasharray={[92, 92]}
              strokeDashoffset={towerL.interpolate({
                inputRange: [0, 1],
                outputRange: [92, 0],
              })}
            />
            <AnimatedPath
              d="M166 118 L166 26"
              stroke="#2dd4bf"
              strokeWidth={7}
              strokeLinecap="round"
              strokeDasharray={[92, 92]}
              strokeDashoffset={towerR.interpolate({
                inputRange: [0, 1],
                outputRange: [92, 0],
              })}
            />
            {/* Suspension cable */}
            <AnimatedPath
              d="M18 96 Q74 34 120 60 Q166 34 222 96"
              stroke="#5eead4"
              strokeWidth={4}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={[cableLength, cableLength]}
              strokeDashoffset={cableDraw.interpolate({
                inputRange: [0, 1],
                outputRange: [cableLength, 0],
              })}
            />
            {/* Deck */}
            <AnimatedPath
              d="M18 118 L222 118"
              stroke="#14b8a6"
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={[deckLength, deckLength]}
              strokeDashoffset={deckDraw.interpolate({
                inputRange: [0, 1],
                outputRange: [deckLength, 0],
              })}
            />
            {/* Suspenders */}
            <Animated.View style={{ opacity: suspenders }}>
              <PathEl d="M48 100 L48 118 M96 76 L96 118 M144 76 L144 118 M192 100 L192 118" stroke="#0d9488" strokeWidth={2.5} strokeLinecap="round" opacity={0.85} />
            </Animated.View>
          </SvgEl>
        </Animated.View>

        {/* Wordmark */}
        <View style={styles.wordmarkRow}>
          {WORDMARK.split("").map((ch, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.wordmarkLetter,
                {
                  opacity: letterAnims[i],
                  transform: [
                    {
                      translateY: letterAnims[i].interpolate({
                        inputRange: [0, 1],
                        outputRange: [16, 0],
                      }),
                    },
                    {
                      scale: letterAnims[i].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.7, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              {ch}
            </Animated.Text>
          ))}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shimmer,
              {
                transform: [
                  {
                    translateX: shimmerX.interpolate({
                      inputRange: [-1, 1],
                      outputRange: [-140, 280],
                    }),
                  },
                  { rotate: "20deg" },
                ],
              },
            ]}
          />
        </View>

        <Animated.Text
          style={[
            styles.tagline,
            { opacity: taglineOpacity, transform: [{ translateY: taglineY }] },
          ]}
        >
          {TAGLINE}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#060b13",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    elevation: 999,
  },
  glowWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  wordmarkRow: {
    flexDirection: "row",
    marginTop: 18,
    overflow: "hidden",
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  wordmarkLetter: {
    fontSize: 34,
    fontWeight: "700",
    color: "#f1f5f9",
    letterSpacing: 0.2,
  },
  shimmer: {
    position: "absolute",
    top: -20,
    width: 46,
    height: 90,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  tagline: {
    marginTop: 12,
    fontSize: 14,
    color: "#5eead4",
    letterSpacing: 0.3,
  },
});
