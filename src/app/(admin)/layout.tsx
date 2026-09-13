import { requireAdmin, AREA_ROLES } from '@/lib/auth';
import { logout } from '@/app/login/actions';
import NavLink from '@/components/NavLink';
import SubmitButton from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

const NAV: { href: string; title: string; area: keyof typeof AREA_ROLES }[] = [
  { href: '/', title: 'Dashboard', area: 'dashboard' },
  { href: '/chapters', title: 'Learning Path', area: 'content' },
  { href: '/badges', title: 'Badges', area: 'content' },
  { href: '/users', title: 'Users', area: 'users' },
  { href: '/community', title: 'Community', area: 'community' },
  { href: '/subscriptions', title: 'Subscriptions', area: 'subscriptions' },
  { href: '/admins', title: 'Admin Accounts', area: 'admins' },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  content_manager: 'Content Manager',
  support: 'Support',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const visibleNav = NAV.filter(item => AREA_ROLES[item.area].includes(admin.role));

  return (
    <div className="flex min-h-screen">
      {/* sticky + h-screen keeps the sidebar in place while a long page scrolls;
          the nav itself scrolls if it ever outgrows the viewport. */}
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-5 py-4">
          <p className="text-lg font-bold text-red-800">Ka Alala</p>
          <p className="text-xs text-neutral-400">Admin Portal</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleNav.map(item => (
            <NavLink key={item.href} href={item.href} title={item.title} />
          ))}
        </nav>

        <div className="border-t border-neutral-100 p-4">
          <p className="truncate text-sm font-medium text-neutral-800">{admin.email}</p>
          <p className="mb-3 text-xs text-neutral-400">{ROLE_LABEL[admin.role]}</p>
          <form action={logout}>
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Signing out...">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
