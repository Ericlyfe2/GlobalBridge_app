import React from "react";
import { Redirect, Tabs } from "expo-router";
import { StyleSheet } from "react-native";

import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { Icon, type IconName } from "@/src/components/Icon";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * The five destinations, exactly as the design names them:
 * Home · Explore · Assistant · Journey · Profile.
 *
 * Five and no more. §3 of the brief is explicit that the bar must not be
 * overcrowded, and the design's own tab map routes fourteen student screens
 * through these five — Messages sits under Assistant, Documents and Scanner
 * under Journey, Mentors under Explore. A sixth tab would mean every one of
 * them gets less room.
 */
const TABS: Array<{ name: string; label: string; icon: IconName }> = [
  { name: "index", label: "Home", icon: "home" },
  { name: "explore", label: "Explore", icon: "explore" },
  { name: "assistant", label: "Assistant", icon: "assistant" },
  { name: "journey", label: "Journey", icon: "journey" },
  { name: "profile", label: "Profile", icon: "profile" },
];

export default function AppLayout() {
  const state = useAuth();
  const { colors, type } = useTheme();

  if (state.status === "signed-out") {
    return <Redirect href="/(auth)/login" />;
  }

  // A Firebase account with no profile behind it -- signup was interrupted
  // between the two writes, or this is the first launch after it. Onboarding
  // is the only thing that can move them forward; the app shell would render
  // a home screen with nothing in it.
  if (state.status === "needs-profile") {
    return <Redirect href="/(auth)/onboarding" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.clay,
        tabBarInactiveTintColor: colors.ink5,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          // Comfortably above the gesture bar. §24: a critical control sitting
          // where the system swipe lives gets triggered by accident.
          height: 62,
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarItemStyle: { minHeight: MIN_TOUCH },
        tabBarLabelStyle: {
          fontSize: type.tag.size,
          fontWeight: type.label.weight,
        },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarIcon: ({ color, focused }) => (
              <Icon name={tab.icon} color={color} active={focused} size={24} />
            ),
          }}
        />
      ))}

      {/*
        Reachable, but not destinations of their own. Expo Router would
        otherwise add a tab for every file in this directory, which is how a
        five-tab bar quietly becomes an eleven-tab bar.
      */}
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="thread" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="tools" options={{ href: null }} />
      <Tabs.Screen name="scan" options={{ href: null }} />
      <Tabs.Screen name="offline" options={{ href: null }} />
      <Tabs.Screen name="documents" options={{ href: null }} />
      <Tabs.Screen name="opportunities" options={{ href: null }} />
      <Tabs.Screen name="ai" options={{ href: null }} />
      <Tabs.Screen name="ai/chat" options={{ href: null }} />
      <Tabs.Screen name="ai/scam-check" options={{ href: null }} />
      <Tabs.Screen name="ai/doc-check" options={{ href: null }} />
      <Tabs.Screen name="ai/visa-roadmap" options={{ href: null }} />
      <Tabs.Screen name="ai/readiness" options={{ href: null }} />
      <Tabs.Screen name="ai/score-essay" options={{ href: null }} />
      <Tabs.Screen name="ai/compare-countries" options={{ href: null }} />
      <Tabs.Screen name="ai/translate" options={{ href: null }} />
    </Tabs>
  );
}
