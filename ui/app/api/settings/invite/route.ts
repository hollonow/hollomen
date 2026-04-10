import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'

const InviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['admin', 'viewer']),
})

export async function POST(request: Request) {
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

  const body = await request.json()
  const parsed = InviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }
  const { email, role } = parsed.data

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tool.luxearchive.com'
  const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { role },
    redirectTo: `${siteUrl}/auth/callback?next=/auth/set-password`,
  })

  if (error) {
    console.error('[/api/settings/invite]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
