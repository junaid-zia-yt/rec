// jest-expo's preset already wires up the RN/Expo native-module mocks. We
// additionally mock expo-secure-store (native-only, not present in the Jest
// environment) and @supabase/supabase-js's realtime/websocket internals are
// avoided entirely because lib/supabase/client.ts never constructs a client
// when `supabaseConfigured` is false, which it always is in this test env
// (no EXPO_PUBLIC_SUPABASE_URL/ANON_KEY are set for tests).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

// @expo-google-fonts/* packages' `useFonts` call `expo-font`'s `loadAsync`,
// which in a real app reads font files from disk/network — unavailable
// (and unnecessary) in the Jest environment. Mocked to resolve immediately
// so `theme/fonts.ts`'s `useAppFonts()` settles to `[true, null]` without
// every test needing to wait on real font loading.
jest.mock('expo-font', () => ({
  loadAsync: jest.fn(async () => undefined),
  isLoaded: jest.fn(() => true),
}))

// react-native-safe-area-context's SafeAreaProvider normally waits for a
// native onLayout measurement before it provides insets to descendants —
// that measurement never happens in the Jest environment, so without this
// official mock (which supplies fixed insets/frame synchronously),
// everything under <SafeAreaProvider>/<SafeAreaView> never renders in tests.
jest.mock('react-native-safe-area-context', () => {
  // The package's own jest mock is an ES default export (a `.tsx` file);
  // its properties need flattening to the module's top level so named
  // imports (`{ SafeAreaProvider, SafeAreaView }`) resolve correctly
  // under Babel's CJS interop, rather than landing nested under `.default`.
  const mock = require('react-native-safe-area-context/jest/mock').default
  return { __esModule: true, ...mock }
})

// react-native-reanimated's real implementation schedules work via
// requestAnimationFrame against native modules (e.g. SettingsManager) that
// don't exist in the Jest environment, which crashes any test that renders
// a component built on it (BottomSheet, via @gorhom/bottom-sheet). The
// package ships its own official jest mock (mock.js) for exactly this —
// used by every screen this wave (Build Phase 13, Wave 4) that renders
// BottomSheet for a confirmation sheet.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))
