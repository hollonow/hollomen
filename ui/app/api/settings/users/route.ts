import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: requester } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (requester?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch emails from auth.users (requires service role — profiles table doesn't store email)
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { users: authUsers }, error: authError } = await adminClient.auth.admin.listUsers()
  if (authError) {
    console.error('[/api/settings/users] listUsers:', authError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Fetch roles and display names from profiles
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, role, created_at')
    .order('created_at', { ascending: true })

  if (profilesError) {
    console.error('[/api/settings/users] profiles:', profilesError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Merge: auth.users provides email, profiles provides role + display name
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))
  const users = authUsers.map(authUser => {
    const profile = profileMap.get(authUser.id)
    return {
      id: authUser.id,
      email: authUser.email ?? '',
      // Normalize empty string → null so UI || fallback to email works correctly
      full_name: profile?.full_name || null,
      role: profile?.role ?? 'viewer',
      created_at: profile?.created_at ?? authUser.created_at,
    }
  }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  // First user by created_at is the superadmin (workspace owner)
  const superAdminId = users[0]?.id ?? null
  const usersWithFlags = users.map(u => ({ ...u, is_super_admin: u.id === superAdminId }))

  return NextResponse.json({ users: usersWithFlags })
}
