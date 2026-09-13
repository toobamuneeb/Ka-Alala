import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Keeps the Supabase session cookie fresh on every request and bounces
 * unauthenticated visitors to /login. Role checks live in lib/auth (pages
 * and server actions), not here - middleware only answers "signed in at all?".
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Reachable signed out: the sign-in form, the reset-link request form, and
  // the callback that turns an emailed code into a session. /reset-password is
  // NOT here - it needs the session that callback creates.
  const isPublic = ['/login', '/forgot-password', '/auth'].some(
    p => path === p || path.startsWith(`${p}/`),
  );
  const isSignedOutOnly = path === '/login' || path === '/forgot-password';

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (user && isSignedOutOnly) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  // Everything except static assets and images.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
