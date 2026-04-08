import { NextRequest, NextResponse } from 'next/server'
import { fetchSessionLogs } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth

  const sessionId = req.nextUrl.searchParams.get('session')
  if (!sessionId) return NextResponse.json({ error: 'Missing session param' }, { status: 400 })
  try {
    const logs = await fetchSessionLogs(sessionId)
    return NextResponse.json({ logs })
  } catch (e) {
    console.error('[/api/reports/logs]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
