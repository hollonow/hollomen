import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const QUEUE_STATUSES = new Set([
  'READY_FOR_SCRAPE',
  'READY_FOR_RESEARCH',
  'READY_FOR_SEO',
  'READY_FOR_PUBLISH',
  'PUBLISHED',
])

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth

  const { product_id } = await req.json()
  if (!product_id) return NextResponse.json({ error: 'product_id required' }, { status: 400 })

  // Verify product is in a queueable status before promoting
  const { data: row } = await supabase
    .from('products')
    .select('status')
    .eq('product_id', product_id)
    .single()

  if (!row) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  if (!QUEUE_STATUSES.has(row.status)) {
    return NextResponse.json({ error: `Cannot prioritize a product in status: ${row.status}` }, { status: 400 })
  }

  // Set created_at far in the past — agents sort by created_at ASC so this
  // product jumps to the front of whichever queue it is currently in.
  const { error } = await supabase
    .from('products')
    .update({ created_at: '2020-01-01T00:00:00+00:00' })
    .eq('product_id', product_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, product_id, status: row.status })
}
