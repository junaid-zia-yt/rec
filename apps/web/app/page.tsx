import { redirect } from 'next/navigation'

// Root route redirects into the authenticated app shell's dashboard.
// A real sign-in gate is out of scope for Build Phase 1 (Authentication is a
// Phase 2 deliverable per docs/15-implementation-roadmap.md); this route
// exists so `/` is never a 404 in the meantime.
export default function RootPage() {
  redirect('/dashboard')
}
