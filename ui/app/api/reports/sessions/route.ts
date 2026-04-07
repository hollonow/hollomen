import { NextResponse } from 'next/server'
import { fetchRunSessions, deleteRunSession } from '@/lib/supabase'
import { requireAuth, requireAdmin } from '@/lib/auth'

export async function GET() {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const sessions = await fetchRunSessions(200)
    return NextResponse.json({ sessions })
  } catch (e) {
    console.error('[/api/reports/sessions GET]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await deleteRunSession(id)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[/api/reports/sessions DELETE]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
