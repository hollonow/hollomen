import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAuth } from '@/lib/auth'

const LOG_FILES: Record<string, string> = {
  agent1: 'miner_run_miner.log',
  agent2: 'researcher_run_researcher.log',
  agent3: 'marketer_run_marketer.log',
  agent4: 'optimizer_run_optimizer.log',
  agent5: 'publisher_run_publisher.log',
}

const LOGS_DIR = path.resolve(process.cwd(), '..', 'logs')

// Parse timestamp from a log line
function parseLogLineMs(line: string): number | null {
  const m = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+\]/)
  if (!m) return null
  return new Date(m[1].replace(' ', 'T')).getTime()
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 })
    }

    const body = await req.json()
    const { agent, startedAt } = body as { agent: string; startedAt: number }

    if (!agent || !LOG_FILES[agent]) {
      return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
    }

    const logPath = path.join(LOGS_DIR, LOG_FILES[agent])
    if (!fs.existsSync(logPath)) {
      return NextResponse.json({ summary: 'Log file not found.' })
    }

    const raw   = fs.readFileSync(logPath, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)

    // Filter to current run's lines only
    const runLines = lines.filter(line => {
      const ts = parseLogLineMs(line)
      if (ts === null) return true
      return ts >= startedAt
    })

    // Extract error lines + one line of context before each
    const errorLines: string[] = []
    for (let i = 0; i < runLines.length; i++) {
      const line = runLines[i]
      if (/\[ERROR\]|\[CRITICAL\]|Traceback|Exception|Error:/i.test(line)) {
        if (i > 0 && !errorLines.includes(runLines[i - 1])) {
          errorLines.push(runLines[i - 1])
        }
        errorLines.push(line)
      }
    }

    if (errorLines.length === 0) {
      return NextResponse.json({ summary: null })  // no errors — caller should not show callout
    }

    // Deduplicate: keep unique error patterns (strip timestamps + product IDs)
    const deduped = [...new Set(
      errorLines.map(l => l.replace(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+\]/g, '').trim())
    )].slice(0, 20)  // cap at 20 unique lines to keep token cost low

    const prompt = deduped.join('\n')

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content: `You are a system monitoring assistant for an e-commerce automation pipeline.
Explain what went wrong in 1-2 short plain-English sentences.
Be specific — mention the exact issue (e.g. "database rejected the status value", "API key missing", "network timeout").
End with one actionable fix if obvious.
No technical jargon. No bullet points. No markdown.`,
          },
          {
            role: 'user',
            content: `These errors appeared in the agent logs:\n\n${prompt}`,
          },
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[/api/interpret-error] OpenAI error:', err)
      return NextResponse.json({ summary: null })
    }

    const data = await response.json()
    const summary: string = data.choices?.[0]?.message?.content?.trim() ?? null

    return NextResponse.json({ summary })
  } catch (err) {
    console.error('[/api/interpret-error]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
