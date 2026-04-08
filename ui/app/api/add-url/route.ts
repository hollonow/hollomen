import { NextResponse } from 'next/server'
import { z } from 'zod'
import { appendRow, appendRows } from '@/lib/supabase'
import { randomBytes } from 'crypto'
import { requireAdmin } from '@/lib/auth'

const AddUrlSchema = z.object({
  url: z.string().url().max(500).optional(),
  urls: z.array(z.string().url().max(500)).optional(),
  isBulk: z.boolean().optional(),
})

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const parsed = AddUrlSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }

    const urls: string[] = parsed.data.urls ?? (parsed.data.url ? [parsed.data.url] : [])

    if (urls.length === 0) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    // Validate and deduplicate
    const valid: string[] = []
    for (const u of urls) {
      const trimmed = u.trim()
      if (!trimmed) continue
      try { new URL(trimmed); valid.push(trimmed) } catch { /* skip */ }
    }

    if (valid.length === 0) {
      return NextResponse.json({ error: 'No valid URLs provided' }, { status: 400 })
    }

    const rows = valid.map(url => ({
      product_id: randomBytes(4).toString('hex').toUpperCase(),
      status: 'READY_FOR_SCRAPE',
      source_url: url,
    }))

    if (rows.length === 1) {
      await appendRow(rows[0])
      return NextResponse.json({ success: true, product_id: rows[0].product_id, count: 1, product_ids: [rows[0].product_id] })
    }

    const count = await appendRows(rows)
    return NextResponse.json({ success: true, count, product_ids: rows.map(r => r.product_id) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/add-url]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
