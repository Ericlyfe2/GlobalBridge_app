const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro config.
 *
 * The app is a native Expo app; some of its dependencies are native-only
 * modules (@react-native-firebase/*, expo-secure-store). Expo can also serve
 * the app on web (used by the Playwright E2E suite), and those modules throw
 * when imported in a browser bundle.
 *
 * Rather than ship web code inside the app source, we alias the native-only
 * packages to thin web shims for the `web` platform only. Native and iOS/Android
 * builds are untouched; the shims live under `src/e2e/` and are never bundled
 * off-web.
 */
const config = getDefaultConfig(__dirname);

const WEB_SHIMS = {
  "@react-native-firebase/auth": "src/e2e/firebase-auth.web.ts",
  "@react-native-firebase/messaging": "src/e2e/firebase-messaging.web.ts",
  "expo-secure-store": "src/e2e/secure-store.web.ts",
};

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shim = platform === "web" ? WEB_SHIMS[moduleName] : undefined;
  if (shim) {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, shim),
    };
  }
  if (resolveRequest) {
    return resolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;