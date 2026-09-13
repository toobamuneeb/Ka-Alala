import PendingLink from './PendingLink';
import { btnSecondary } from './ui';

/**
 * Shared list footer. A server component so `hrefFor` can stay a plain
 * function - it never crosses a client boundary; only the PendingLinks it
 * renders do.
 */
export default function Pagination({
  page,
  totalPages,
  from,
  shown,
  total,
  hrefFor,
  noun = 'items',
}: {
  page: number;
  totalPages: number;
  /** Zero-based index of the first row on this page. */
  from: number;
  /** How many rows this page actually rendered. */
  shown: number;
  total: number;
  hrefFor: (page: number) => string;
  noun?: string;
}) {
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between border-t border-neutral-100 pt-4">
      <p className="text-xs text-neutral-500">
        Showing {from + 1}-{from + shown} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <PendingLink href={hrefFor(page - 1)} className={btnSecondary}>
            ← Previous
          </PendingLink>
        ) : (
          <span className={`${btnSecondary} pointer-events-none opacity-40`}>← Previous</span>
        )}
        <span className="text-xs text-neutral-500">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <PendingLink href={hrefFor(page + 1)} className={btnSecondary}>
            Next →
          </PendingLink>
        ) : (
          <span className={`${btnSecondary} pointer-events-none opacity-40`}>Next →</span>
        )}
      </div>
    </div>
  );
}
