import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'

const StopSchema = z.object({
  agent: z.enum(['agent0', 'agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'pipeline']),
})

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * POST /api/stop-agent
 * Body: { agent: 'agent1' | ... | 'pipeline' }
 *
 * Sets stop_requested=true on the running session for this agent in Supabase.
 * Python agents poll check_stop_requested() between items and break gracefully.
 * 'pipeline' is handled by the frontend loop — no DB action needed.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await request.json()
    const parsed = StopSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid agent' }, { status: 400 })
    }

    const { agent } = parsed.data

    // 'pipeline' stop is handled purely by the frontend loop
    if (agent === 'pipeline') {
      return NextResponse.json({ success: true, method: 'frontend' })
    }

    const supabase = getSupabase()
    const { error } = await supabase
      .from('run_sessions')
      .update({ stop_requested: true })
      .eq('agent', agent)
      .eq('status', 'running')

    if (error) {
      console.error('[/api/stop-agent] Supabase error:', error)
      return NextResponse.json({ error: 'Failed to request stop' }, { status: 500 })
    }

    return NextResponse.json({ success: true, method: 'supabase' })
  } catch (err) {
    console.error('[/api/stop-agent]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
