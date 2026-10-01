import * as SecureStore from 'expo-secure-store'

/**
 * Supabase JS's `Storage` interface (getItem/setItem/removeItem), backed by
 * `expo-secure-store` instead of `localStorage` (which does not exist in
 * React Native) — this is what makes the mobile session persist encrypted
 * on-device (iOS Keychain / Android Keystore) rather than in an
 * unencrypted AsyncStorage blob, per the brief's "secure credential
 * storage" / "never store service-role keys" requirements. Mobile only
 * ever holds the anon key + a user's own session JWT, exactly like the web
 * browser client (apps/web/lib/supabase/client.ts) — never a service-role
 * key.
 *
 * KNOWN LIMITATION: `expo-secure-store` enforces a ~2048 byte per-value
 * limit on Android (iOS Keychain has no such practical limit). A Supabase
 * session object (access token + refresh token + user metadata, JSON
 * stringified) is normally well under that on its own, but a large
 * `user.user_metadata`/`app_metadata` payload from a heavily-customized
 * auth setup could exceed it. We deliberately do NOT chunk/split values
 * here (chunking would need to be symmetric with read, and a partial write
 * failure could silently corrupt a session token, which is worse than a
 * loud failure) — instead, `setItem` lets `SecureStore`'s own error
 * surface, so a value that's too large fails the sign-in explicitly rather
 * than truncating a session that later fails auth in a confusing way. If
 * this limitation is hit in practice, the fix is to trim what Supabase
 * Auth is configured to embed in the JWT/user metadata, not to chunk
 * storage here.
 */
export const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}
