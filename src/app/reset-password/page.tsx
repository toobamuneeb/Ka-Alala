import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { updatePassword } from './actions';
import { Flash, input, label } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;

  // Reached with the session /auth/callback just created from the email link.
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      '/forgot-password?error=' +
        encodeURIComponent('Open the link from your reset email to set a new password.'),
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-red-800">Choose a new password</h1>
          <p className="mt-1 text-sm text-neutral-500">for {user.email}</p>
        </div>

        <Flash searchParams={params} />

        <form
          action={updatePassword}
          className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <div>
            <label htmlFor="password" className={label}>New password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={input}
            />
            <p className="mt-1 text-xs text-neutral-400">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="confirm" className={label}>Confirm new password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={input}
            />
          </div>
          <SubmitButton className="w-full" pendingLabel="Updating...">Update password</SubmitButton>
        </form>
      </div>
    </main>
  );
}
