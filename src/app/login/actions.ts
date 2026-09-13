'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect('/login?error=' + encodeURIComponent('Email and password are required.'));
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect('/login?error=' + encodeURIComponent(error?.message || 'Invalid credentials.'));
  }

  // Only accounts present in admin_users may enter - a valid mobile-app
  // account is NOT an admin account.
  const { data: admin } = await supabaseAdmin()
    .from('admin_users')
    .select('id')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!admin) {
    await supabase.auth.signOut();
    redirect('/login?error=' + encodeURIComponent('This account does not have admin access.'));
  }

  redirect('/');
}

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}
