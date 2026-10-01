import { LoadingSkeleton } from '@rqi/ui'

export default function OutreachLoading() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading outreach">
      <LoadingSkeleton className="h-8 w-48" />
      <LoadingSkeleton className="h-48" />
    </div>
  )
}
