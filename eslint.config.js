// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Generated / build artifacts (should never be linted).
    ignores: ['dist/*', '.expo/**', 'android/**/build/**'],
  },
]);
