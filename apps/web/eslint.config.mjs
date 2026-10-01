import nextConfig from 'eslint-config-next'

/**
 * Flat ESLint config — eslint-config-next 16 requires eslint >= 9 and ships
 * only a flat-config export (dist/index.js), so Build Phase 1 uses eslint 9
 * + this flat config instead of the legacy .eslintrc format. jsx-a11y rules
 * are already included in eslint-config-next's default export.
 */
const config = [
  ...nextConfig,
  {
    ignores: ['playwright-report/**', 'test-results/**'],
  },
]

export default config
