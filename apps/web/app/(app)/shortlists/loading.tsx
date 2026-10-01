import { LoadingSkeleton } from '@rqi/ui'

export default function ShortlistsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading shortlists">
      <LoadingSkeleton className="h-8 w-48" />
      <LoadingSkeleton className="h-16" />
    </div>
  )
}
