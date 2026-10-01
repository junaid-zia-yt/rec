import { LoadingSkeleton } from '@rqi/ui'

export default function IntegrationsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading integrations">
      <LoadingSkeleton className="h-8 w-48" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <LoadingSkeleton key={i} className="h-16" />
        ))}
      </div>
    </div>
  )
}
