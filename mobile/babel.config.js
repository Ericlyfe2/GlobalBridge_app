const { expoRouterBabelPlugin } = require("babel-preset-expo/build/expo-router-plugin");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // babel-preset-expo only registers this plugin when `expo-router` is
    // resolvable from its own (hoisted) location. In this monorepo expo-router
    // lives under mobile/node_modules, so register it explicitly.
    plugins: [expoRouterBabelPlugin],
  };
};