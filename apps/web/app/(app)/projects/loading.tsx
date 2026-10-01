import { LoadingSkeleton } from '@rqi/ui'

export default function ProjectsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading projects">
      <LoadingSkeleton className="h-8 w-64" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <LoadingSkeleton key={i} className="h-28" />
        ))}
      </div>
    </div>
  )
}
