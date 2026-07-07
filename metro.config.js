// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// `inlineRem: false` keeps Tailwind's rem-based sizes (all `text-*` classes)
// resolving against NativeWind's runtime `rem` observable instead of being baked
// into fixed pixels at build time. That's what lets the in-app font-size setting
// rescale text live — see services/preferences/fontScaling.ts.
module.exports = withNativeWind(config, { input: './app/global.css', inlineRem: false });