import { Spinner } from '@/components/ui';

/**
 * Shown the moment a navigation starts, for every admin route. Without it the
 * old page just sits there while the server renders the new one.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm font-medium text-neutral-500">
        <Spinner className="text-red-700" />
        Loading...
      </div>
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-neutral-200/70" />
        <div className="h-40 animate-pulse rounded-xl bg-neutral-200/50" />
      </div>
    </div>
  );
}
