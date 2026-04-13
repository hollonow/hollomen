import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'

const RemoveSchema = z.object({
  userId: z.string().uuid(),
})

export async function DELETE(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Determine the superadmin: first user by created_at (workspace owner)
  const { data: { users: allUsers } } = await adminClient.auth.admin.listUsers()
  const sorted = (allUsers ?? []).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  const superAdminId = sorted[0]?.id

  // Only the superadmin can remove members
  if (user.id !== superAdminId) {
    return NextResponse.json({ error: 'Only the workspace owner can remove members' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = RemoveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }
  const { userId } = parsed.data

  // Cannot remove yourself
  if (userId === user.id) {
    return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
  }

  const { error } = await adminClient.auth.admin.deleteUser(userId)
  if (error) {
    console.error('[/api/settings/remove]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
