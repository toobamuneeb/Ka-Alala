import Link from 'next/link';
import { login } from './actions';
import { Flash, input, label } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-red-800">Ka Alala Admin</h1>
          <p className="mt-1 text-sm text-neutral-500">Sign in with your admin account</p>
        </div>

        <Flash searchParams={params} />

        <form action={login} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="email" className={label}>Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" className={input} />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="password" className={label}>Password</label>
              <Link href="/forgot-password" className="mb-1 text-xs font-medium text-red-700 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input id="password" name="password" type="password" required autoComplete="current-password" className={input} />
          </div>
          <SubmitButton className="w-full" pendingLabel="Signing in...">Sign in</SubmitButton>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-400">
          Access is limited to accounts registered in admin_users.
        </p>
      </div>
    </main>
  );
}
