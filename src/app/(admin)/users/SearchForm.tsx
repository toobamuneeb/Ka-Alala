'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Spinner, input, btnSecondary } from '@/components/ui';

/**
 * The search box used to be a plain GET form, which reloaded the document and
 * left the button looking untouched. Routing it through useTransition keeps the
 * navigation client-side and gives the same pending spinner as every other
 * button in the panel.
 */
export default function SearchForm({ defaultQuery }: { defaultQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQuery);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex max-w-md gap-2"
      onSubmit={e => {
        e.preventDefault();
        const query = q.trim();
        startTransition(() => router.push(query ? `/users?q=${encodeURIComponent(query)}` : '/users'));
      }}
    >
      <input
        name="q"
        value={q}
        onChange={e => setQ(e.target.value)}
        className={input}
        placeholder="Search by email or name..."
      />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={`${btnSecondary} ${pending ? 'cursor-wait' : ''}`}
      >
        {pending && <Spinner className="mr-2" />}
        {pending ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}
