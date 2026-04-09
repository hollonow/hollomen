import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/auth'

const LOG_FILES: Record<string, string> = {
  agent0: 'calibrator_run_calibrator.log',
  agent1: 'miner_run_miner.log',
  agent2: 'researcher_run_researcher.log',
  agent3: 'marketer_run_marketer.log',
  agent4: 'optimizer_run_optimizer.log',
  agent5: 'publisher_run_publisher.log',
}

const AGENT_PREFIX: Record<string, string> = {
  agent0: 'AGENT_0',
  agent1: 'AGENT_1',
  agent2: 'AGENT_2',
  agent3: 'AGENT_3',
  agent4: 'AGENT_4',
  agent5: 'AGENT_5',
}

const LOGS_DIR = path.resolve(process.cwd(), '..', 'logs')
const MAX_LINES = 120

// Parse the timestamp from a log line: [AGENT_N] [YYYY-MM-DD HH:MM:SS,mmm] [LEVEL] msg
function parseLogLineMs(line: string): number | null {
  const m = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+\]/)
  if (!m) return null
  return new Date(m[1].replace(' ', 'T')).getTime()
}

// Format a Supabase pipeline_logs row as a log line matching the local file format.
// Result: [AGENT_N] [YYYY-MM-DD HH:MM:SS,mmm] [LEVEL] message
function formatLogRow(row: { created_at: string; agent: string; level: string; message: string }): string {
  const prefix = AGENT_PREFIX[row.agent] ?? row.agent.toUpperCase()
  const level  = (row.level ?? 'INFO').toUpperCase()
  const d = new Date(row.created_at)
  // ISO → "YYYY-MM-DD HH:MM:SS,mmm" (matches Python's %(asctime)s format)
  const ts = d.toISOString()
    .replace('T', ' ')
    .replace(/\.(\d{3})\d*Z$/, ',$1Z')
  return `[${prefix}] [${ts}] [${level}] ${row.message}`
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export async function GET(req: Request) {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const { searchParams } = new URL(req.url)
    const agent = searchParams.get('agent')
    if (!agent || !LOG_FILES[agent]) {
      return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
    }

    // Optional session time-range filter (from= and to= are ms since epoch)
    const fromMs = searchParams.get('from') ? parseInt(searchParams.get('from')!) : null
    const toMs   = searchParams.get('to')   ? parseInt(searchParams.get('to')!)   : null

    // Validate timestamp ranges to prevent unbounded queries
    const now = Date.now()
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    const MAX_RANGE_MS   = 24 * 60 * 60 * 1000  // 24 hours max range

    if (fromMs && (fromMs < now - THIRTY_DAYS_MS || fromMs > now)) {
      return NextResponse.json({ error: 'Invalid from timestamp' }, { status: 400 })
    }
    if (fromMs && toMs && (toMs - fromMs > MAX_RANGE_MS || toMs < fromMs)) {
      return NextResponse.json({ error: 'Invalid time range' }, { status: 400 })
    }

    // ── Try local log file first (local dev) ────────────────────────────────
    const logPath = path.join(LOGS_DIR, LOG_FILES[agent])

    if (fs.existsSync(logPath)) {
      const stat  = fs.statSync(logPath)
      const raw   = fs.readFileSync(logPath, 'utf-8')
      const lines = raw.split('\n').filter(Boolean)

      if (fromMs !== null) {
        const padMs = 5_000
        const filtered = lines.filter(line => {
          const ts = parseLogLineMs(line)
          if (ts === null) return false
          return ts >= (fromMs - padMs) && (toMs === null || ts <= (toMs + padMs))
        })
        return NextResponse.json({ lines: filtered, mtime: stat.mtimeMs })
      }

      return NextResponse.json({ lines: lines.slice(-MAX_LINES), mtime: stat.mtimeMs })
    }

    // ── Fall back to Supabase pipeline_logs (cloud / Modal deployment) ──────
    const supabase = getSupabase()

    if (fromMs !== null) {
      const padMs   = 5_000
      const fromIso = new Date(fromMs - padMs).toISOString()
      const toIso   = toMs ? new Date(toMs + padMs).toISOString() : new Date().toISOString()

      const { data, error } = await supabase
        .from('pipeline_logs')
        .select('created_at, agent, level, message')
        .eq('agent', agent)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: true })

      if (error) throw new Error(error.message)
      const lines = (data ?? []).map(formatLogRow)
      return NextResponse.json({ lines, mtime: null })
    }

    // Last MAX_LINES for live log view
    const { data, error } = await supabase
      .from('pipeline_logs')
      .select('created_at, agent, level, message')
      .eq('agent', agent)
      .order('created_at', { ascending: false })
      .limit(MAX_LINES)

    if (error) throw new Error(error.message)
    const lines = (data ?? []).reverse().map(formatLogRow)
    return NextResponse.json({ lines, mtime: null })

  } catch (err) {
    console.error('[/api/logs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
