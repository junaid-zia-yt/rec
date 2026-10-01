import '@testing-library/jest-dom/vitest'

// Shared Vitest setup — imported via each app's vitest.config.ts `setupFiles`.
// Keeps jest-dom matchers (toBeInTheDocument, toHaveAccessibleName, etc.)
// available to every test in the monorepo from one place.
