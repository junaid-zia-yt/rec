import { AppShell } from '@/components/domain/app-shell'

export default function AppRouteGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
