import type { ReactNode } from 'react';

/** Tiny shared presentational pieces - plain Tailwind, no client JS. */

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-neutral-900">{value}</p>
    </div>
  );
}

export const input =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100';

export const label = 'mb-1 block text-xs font-medium text-neutral-600';

export const btnPrimary =
  'inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50';

export const btnSecondary =
  'inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:hover:bg-white';

export const btnDanger =
  'inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-white';

/** Spinning ring, sized to sit inline with button text. */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z"
      />
    </svg>
  );
}

export const th = 'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500';
export const td = 'px-4 py-3 text-sm text-neutral-800';

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-neutral-400">
        {text}
      </td>
    </tr>
  );
}

export function Flash({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  if (searchParams.error) {
    return (
      <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
        {decodeURIComponent(searchParams.error)}
      </p>
    );
  }
  if (searchParams.ok) {
    return (
      <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
        {decodeURIComponent(searchParams.ok)}
      </p>
    );
  }
  return null;
}
