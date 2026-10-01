/**
 * (auth) route group layout — sign-in, forgot-password, reset-password,
 * accept-invitation. No confirmed Stitch screenshot exists for these
 * screens (docs/03-screen-inventory.md marks "Sign in / Sign up" as
 * [GAP]), so this is composed from the established design tokens/
 * components (Card, centered single-column layout on the canvas
 * background) rather than a source screen, per the same convention already
 * used for other unconfirmed screens (docs/design-system-implementation.md).
 *
 * Deliberately does not use AppShell (no nav rail/bottom nav — there is
 * nothing to navigate to before a session exists).
 */
export default function AuthRouteGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-1 text-center">
        <span className="font-display text-tertiary text-lg font-bold tracking-tight">
          Recruitment Quality Intelligence
        </span>
        <span className="text-muted text-sm">
          Evidence before scoring. Quality before quantity.
        </span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
