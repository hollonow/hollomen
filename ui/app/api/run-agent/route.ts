import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import { requireAdmin } from '@/lib/auth'
import { z } from 'zod'

const productIdSchema = z.string().regex(/^[A-F0-9]{8}$/i).optional()

const SCRIPTS: Record<string, string> = {
  agent0: 'run_calibrator.py',
  agent1: 'run_miner.py',
  agent2: 'run_researcher.py',
  agent3: 'run_marketer.py',
  agent4: 'run_optimizer.py',
  agent5: 'run_publisher.py',
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const { agent, productId } = await req.json()
    const script = SCRIPTS[agent]
    if (!script) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })

    if (productId !== undefined) {
      const result = productIdSchema.safeParse(productId)
      if (!result.success) {
        return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
      }
    }

    // Check for a Modal web endpoint URL (e.g. MODAL_URL_AGENT1)
    const modalUrl = process.env[`MODAL_URL_${agent.toUpperCase()}`]

    if (modalUrl) {
      const body: Record<string, string> = {}
      if (productId) body.product_id = productId

      const res = await fetch(modalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json(
          { error: `Modal returned ${res.status}: ${text}` },
          { status: 502 },
        )
      }

      return NextResponse.json({
        success: true,
        message: `${agent} started via Modal${productId ? ` for ${productId}` : ''}`,
      })
    }

    // Local spawn fallback (development / non-Modal deployment)
    const executionDir = path.resolve(process.cwd(), '..', 'execution')

    const args = productId ? [script, '--product-id', productId] : [script]

    // windowsHide:true prevents a console window from popping up.
    // shell:false ensures windowsHide applies directly to Python (not a cmd.exe wrapper).
    const child = spawn('python', args, {
      cwd: executionDir,
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    })

    child.on('error', err => {
      console.error(`[/api/run-agent] spawn error for ${agent}:`, err)
    })

    child.unref()

    return NextResponse.json({ success: true, message: `${agent} started${productId ? ` for ${productId}` : ''}` })
  } catch (err) {
    console.error('[/api/run-agent]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
