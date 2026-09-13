import Link from 'next/link';
import { requestPasswordReset, verifyResetCode } from './actions';
import { Flash, input, label } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

/**
 * Two steps on one route: no `email` in the URL means "ask for the email",
 * and an `email` means "the code has been sent, now enter it". Keeping both in
 * one page is what lets the whole flow run on plain form posts, no client JS.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const email = params.email?.trim();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-red-800">Reset your password</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {email
              ? `Enter the 6-digit code we sent to ${email}.`
              : "We'll email you a 6-digit code."}
          </p>
        </div>

        <Flash searchParams={params} />

        {email ? (
          <>
            <form
              action={verifyResetCode}
              className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <input type="hidden" name="email" value={email} />
              <div>
                <label htmlFor="token" className={label}>6-digit code</label>
                <input
                  id="token"
                  name="token"
                  type="text"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                  className={`${input} text-center text-lg tracking-[0.5em] font-semibold`}
                />
                <p className="mt-1 text-xs text-neutral-400">The code expires in about an hour.</p>
              </div>
              <SubmitButton className="w-full" pendingLabel="Verifying...">Verify code</SubmitButton>
            </form>

            <form action={requestPasswordReset} className="mt-4 text-center">
              <input type="hidden" name="email" value={email} />
              <SubmitButton
                variant="ghost"
                className="text-sm text-neutral-500 hover:text-red-700"
                pendingLabel="Sending a new code..."
              >
                Didn&apos;t get it? Send a new code
              </SubmitButton>
            </form>

            <p className="mt-2 text-center text-sm">
              <Link href="/forgot-password" className="text-neutral-400 hover:text-red-700">
                Use a different email
              </Link>
            </p>
          </>
        ) : (
          <form
            action={requestPasswordReset}
            className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <div>
              <label htmlFor="email" className={label}>Admin email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className={input}
              />
            </div>
            <SubmitButton className="w-full" pendingLabel="Sending...">Send code</SubmitButton>
          </form>
        )}

        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-neutral-500 hover:text-red-700">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
