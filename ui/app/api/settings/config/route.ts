import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { requireAdmin } from '@/lib/auth'

const CONFIG_PATH = join(process.cwd(), '..', 'config', 'pipeline_config.json')

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return { batch_size: 20, auto_advance: true, confidence_threshold: 0.30, auto_approve_reviews: false }
  }
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(readConfig())
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const body = await req.json()
    const current = readConfig()
    const updated = {
      batch_size:            typeof body.batch_size === 'number'  ? Math.min(50, Math.max(1, body.batch_size)) : current.batch_size,
      auto_advance:          typeof body.auto_advance === 'boolean'         ? body.auto_advance         : current.auto_advance,
      confidence_threshold:  typeof body.confidence_threshold === 'number'  ? body.confidence_threshold : current.confidence_threshold,
      auto_approve_reviews:  typeof body.auto_approve_reviews === 'boolean' ? body.auto_approve_reviews : current.auto_approve_reviews,
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2))
    return NextResponse.json({ ok: true, config: updated })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
