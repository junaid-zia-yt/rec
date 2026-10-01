import { LoadingSkeleton } from '@rqi/ui'

export default function CandidatesLoading() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading candidates">
      <LoadingSkeleton className="h-8 w-48" />
      <LoadingSkeleton className="h-11 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <LoadingSkeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  )
}
