import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/** Returns the authenticated user or a 401 NextResponse. Call at top of each route handler. */
export async function requireAuth(): Promise<{ user: unknown } | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return { user }
}

/** Returns admin profile or 403 NextResponse. */
export async function requireAdmin(): Promise<{ user: unknown } | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { user }
}
