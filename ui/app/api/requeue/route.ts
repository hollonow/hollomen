import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updateRow } from '@/lib/supabase'
import { requireAdmin } from '@/lib/auth'

const RequeueSchema = z.object({
  product_id: z.string().regex(/^[A-F0-9]{8}$/i, 'Invalid product_id'),
  current_status: z.string().max(50).optional(),
})

// Maps each failure status -> the pipeline stage it should revert to
const RETRY_STATUS: Record<string, string> = {
  SCRAPE_FAILED:    'READY_FOR_SCRAPE',
  RESEARCH_FAILED:  'READY_FOR_RESEARCH',
  SEO_FAILED:       'READY_FOR_SEO',
  OPTIMIZE_FAILED:  'READY_FOR_PUBLISH',
  PUBLISH_FAILED:   'PUBLISHED',
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const parsed = RequeueSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid product_id' }, { status: 400 })
    }

    const { product_id, current_status } = parsed.data

    // Look up retry target, or fall back to any *_FAILED pattern
    let retryStatus = current_status ? RETRY_STATUS[current_status] : undefined
    if (!retryStatus) {
      // Generic fallback: try to infer from suffix
      // e.g. DISCOVERY_FAILED -> READY_FOR_SCRAPE
      retryStatus = 'READY_FOR_SCRAPE'
    }

    await updateRow(product_id, {
      status: retryStatus,
      notes:  `Re-queued from ${current_status ?? 'unknown'} — ${new Date().toISOString()}`,
    } as never)

    return NextResponse.json({ success: true, new_status: retryStatus })
  } catch (err) {
    console.error('[/api/requeue]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
