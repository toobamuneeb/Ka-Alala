'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Spinner, btnPrimary, btnSecondary, btnDanger } from './ui';

const VARIANT = {
  primary: btnPrimary,
  secondary: btnSecondary,
  danger: btnDanger,
  /** No chrome - for links-that-are-really-submits, styled by className. */
  ghost: 'inline-flex items-center justify-center disabled:opacity-50',
} as const;

/**
 * Submit button that shows the server action running and blocks a second click
 * while it does. `useFormStatus` reads the pending state of the nearest parent
 * <form>, which is why this has to be its own component rather than markup
 * inside the page.
 *
 * Blocking the second click matters as much as the spinner: without it, an
 * impatient double-click on "Create lesson" ran the action twice.
 */
export default function SubmitButton({
  children,
  variant = 'primary',
  className = '',
  pendingLabel,
  iconOnly = false,
  disabled = false,
  title,
}: {
  children: ReactNode;
  variant?: keyof typeof VARIANT;
  className?: string;
  /** Text while running, e.g. "Uploading..." - defaults to the normal label. */
  pendingLabel?: string;
  /** Small square buttons (the ↑ / ↓ reorder pair) show only the spinner. */
  iconOnly?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      title={title}
      aria-busy={pending}
      disabled={pending || disabled}
      className={`${VARIANT[variant]} ${pending ? 'cursor-wait' : ''} ${className}`}
    >
      {pending && <Spinner className={iconOnly ? '' : 'mr-2'} />}
      {pending && iconOnly ? null : pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
