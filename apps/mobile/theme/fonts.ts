import {
  useFonts as useSpaceGroteskFonts,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk'
import {
  useFonts as useGeistFonts,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from '@expo-google-fonts/geist'

/**
 * §4.3 calls for Space Grotesk (headlines/metrics) + Geist (body/labels).
 * Both are available as installable `@expo-google-fonts/*` packages (the
 * expected fallback per the brief — "if geist isn't available... fall back
 * to a documented alternative" — was NOT needed: `@expo-google-fonts/geist`
 * exists on the npm registry and is used directly, no substitution).
 *
 * `useAppFonts()` loads both families and returns `[fontsLoaded, error]` —
 * App.tsx gates rendering on `fontsLoaded` so no screen ever falls back to
 * the OS default font mid-render.
 */
export function useAppFonts(): [boolean, Error | null] {
  const [spaceGroteskLoaded, spaceGroteskError] = useSpaceGroteskFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  })
  const [geistLoaded, geistError] = useGeistFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
  })

  return [spaceGroteskLoaded && geistLoaded, spaceGroteskError ?? geistError ?? null]
}
