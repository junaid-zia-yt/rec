/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['react-native-gesture-handler/jestSetup', './jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // __tests__/test-utils/ holds shared test helpers (e.g. the fake
  // Supabase query builder), not test suites themselves — without this,
  // Jest's default testMatch (which matches anything under __tests__/)
  // tries to run them as suites and fails with "must contain at least one
  // test".
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/test-utils/'],
  // jest-expo's own preset ships a transformIgnorePatterns entry covering
  // react-native/expo/@react-navigation/@gorhom/etc's untranspiled Flow/TS
  // source in node_modules, but that pattern assumes a flat/hoisted
  // node_modules layout (npm/yarn). pnpm's default layout nests real
  // packages under `node_modules/.pnpm/<name>@<version>/node_modules/...`,
  // so the FIRST "node_modules/" segment in the path (the one right before
  // ".pnpm") is what the preset's regex tests against — it never reaches
  // the real package name, so every RN/Expo package is (wrongly) left
  // untransformed and Jest chokes on their Flow syntax. This override
  // targets the pnpm store's own naming (scoped packages are flattened
  // with a literal "+", e.g. ".pnpm/@react-native+js-polyfills@0.76.9/")
  // so packages that need Babel are still transformed correctly under
  // pnpm's node-modules layout.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!(jest-expo|(jest-)?react-native|@react-native\\+|expo|@expo(nent)?\\+|@expo-google-fonts\\+|react-navigation|@react-navigation\\+|@sentry\\+react-native|native-base|react-native-svg|@gorhom\\+)[^/]*/)',
  ],
  collectCoverageFrom: ['**/*.{ts,tsx}', '!**/coverage/**', '!**/node_modules/**'],
}
