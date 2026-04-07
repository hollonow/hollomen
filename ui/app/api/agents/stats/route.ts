import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/auth'

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const TRIGGER_STATUSES = {
  agent1: 'READY_FOR_SCRAPE',
  agent2: 'READY_FOR_RESEARCH',
  agent3: 'READY_FOR_SEO',
  agent4: 'READY_FOR_PUBLISH',
  agent5: 'PUBLISHED',
}

export async function GET() {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const supabase = getClient()
    const { data, error } = await supabase
      .from('products')
      .select('status')

    if (error) throw new Error(error.message)

    const rows = data ?? []

    // Count per trigger status
    const queues: Record<string, number> = {
      agent1: 0, agent2: 0, agent3: 0, agent4: 0, agent5: 0,
    }
    let needsReview = 0
    let failed = 0
    let live = 0
    let pendingApproval = 0

    for (const row of rows) {
      const s: string = row.status ?? ''
      for (const [agent, status] of Object.entries(TRIGGER_STATUSES)) {
        if (s === status) queues[agent]++
      }
      if (s === 'NEEDS_REVIEW') needsReview++
      if (s.includes('FAILED')) failed++
      if (s === 'LIVE') live++
      if (s === 'PENDING_APPROVAL') pendingApproval++
    }

    return NextResponse.json({ queues, needsReview, failed, live, pendingApproval, total: rows.length })
  } catch (err) {
    console.error('[/api/agents/stats]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
