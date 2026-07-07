/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ["./components/**/*.{js,jsx,ts,tsx}", "./app/**/*.{js,jsx,ts,tsx}"],
  // Manual (class-based) dark mode: the in-app Theme toggle drives the color
  // scheme via NativeWind's `colorScheme.set()` (see services/preferences).
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
}