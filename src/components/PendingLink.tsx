'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';
import { Spinner } from './ui';

/**
 * useLinkStatus only reports on the <Link> it sits under, so the spinner has
 * to be a child of the link rather than a sibling.
 */
function LinkSpinner({ className = '' }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : null;
}

/**
 * A link that says it was clicked. Every admin page is force-dynamic, so a
 * navigation waits on the server with nothing to show otherwise - which is
 * exactly when you start wondering whether the click registered.
 */
export default function PendingLink({
  href,
  children,
  className = '',
  spinnerClassName = 'ml-2',
}: {
  href: string;
  children: ReactNode;
  className?: string;
  spinnerClassName?: string;
}) {
  return (
    <Link href={href} className={className}>
      {children}
      <LinkSpinner className={spinnerClassName} />
    </Link>
  );
}

export { LinkSpinner };
