'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LinkSpinner } from './PendingLink';

/**
 * Sidebar link: highlights the section you're in, and spins while the next
 * page is being fetched.
 */
export default function NavLink({ href, title }: { href: string; title: string }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
        active
          ? 'bg-red-50 text-red-800'
          : 'text-neutral-700 hover:bg-red-50 hover:text-red-800'
      }`}
    >
      <span className="flex-1">{title}</span>
      <LinkSpinner className="ml-2 text-red-700" />
    </Link>
  );
}
