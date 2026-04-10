import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'

const CONFIG_PATH = join(process.cwd(), '..', 'config', 'pipeline_config.json')

const DEFAULTS = { batch_size: 20, auto_advance: true, confidence_threshold: 0.30, auto_approve_reviews: false }

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

function readFileConfig(): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch { return null }
}

async function readSupabaseConfig(): Promise<Record<string, unknown>> {
  try {
    const { data } = await getSupabase()
      .from('pipeline_configs')
      .select('value')
      .eq('key', 'default')
      .single()
    return (data?.value as Record<string, unknown>) ?? DEFAULTS
  } catch { return DEFAULTS }
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  // Local dev: read from filesystem. Vercel (read-only FS): fall back to Supabase.
  const fileConfig = readFileConfig()
  if (fileConfig) return NextResponse.json(fileConfig)
  return NextResponse.json(await readSupabaseConfig())
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body    = await req.json()
    const current = readFileConfig() ?? await readSupabaseConfig()
    const updated = {
      batch_size:           typeof body.batch_size === 'number'           ? Math.min(50, Math.max(1, body.batch_size)) : current.batch_size,
      auto_advance:         typeof body.auto_advance === 'boolean'        ? body.auto_advance         : current.auto_advance,
      confidence_threshold: typeof body.confidence_threshold === 'number' ? body.confidence_threshold : current.confidence_threshold,
      auto_approve_reviews: typeof body.auto_approve_reviews === 'boolean'? body.auto_approve_reviews : current.auto_approve_reviews,
    }

    // Try filesystem first (local dev). Vercel filesystem is read-only — catch and move on.
    try { writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2)) } catch { /* Vercel */ }

    // Always persist to Supabase so changes survive on cloud deployments.
    await getSupabase()
      .from('pipeline_configs')
      .upsert({ key: 'default', value: updated }, { onConflict: 'key' })

    return NextResponse.json({ ok: true, config: updated })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
