import { LoadingSkeleton } from '@rqi/ui'

export default function POCComparisonLoading() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading POC comparison">
      <LoadingSkeleton className="h-8 w-48" />
      <LoadingSkeleton className="h-16" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <LoadingSkeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  )
}
