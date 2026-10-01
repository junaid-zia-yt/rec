// Flat ESLint config, mirroring apps/web's eslint.config.mjs approach
// (flat config, framework preset spread + local overrides) but for the
// Expo/React Native toolchain via `eslint-config-expo`'s flat export.
const expoConfig = require('eslint-config-expo/flat')

module.exports = [
  ...expoConfig,
  {
    ignores: ['.expo/**', 'dist/**', 'node_modules/**'],
  },
  {
    files: ['jest.setup.js', 'jest.config.js', '**/__tests__/**', '**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
]
