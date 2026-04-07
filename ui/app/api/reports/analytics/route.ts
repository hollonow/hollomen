import { NextResponse } from 'next/server'
import { fetchAllProducts, fetchRunSessions } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

function msLabel(ms: number): string {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function stageStats(values: number[]) {
  if (values.length === 0) return null
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  return {
    avg: msLabel(avg),
    min: msLabel(Math.min(...values)),
    max: msLabel(Math.max(...values)),
    count: values.length,
  }
}

export async function GET() {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const [{ products }, sessions] = await Promise.all([
      fetchAllProducts(),
      fetchRunSessions(200),
    ])

    // Stage counts
    const stageCounts: Record<string, number> = {}
    for (const p of products) {
      const s = p.status ?? 'UNKNOWN'
      stageCounts[s] = (stageCounts[s] ?? 0) + 1
    }

    // Agent processing time per product — from run_sessions (actual agent wall-clock time)
    // Keyed by agent key: 'agent1' … 'agent5'
    const agentMs: Record<string, number[]> = {}
    for (const s of sessions) {
      if (s.status !== 'completed') continue
      if (!s.duration_seconds || !s.products_succeeded || s.products_succeeded < 1) continue
      const msPerProduct = (s.duration_seconds / s.products_succeeded) * 1000
      if (!agentMs[s.agent]) agentMs[s.agent] = []
      agentMs[s.agent].push(msPerProduct)
    }

    // Map agent keys to human-readable stage names
    const agentSlots: [string, string][] = [
      ['agent1', 'Mining (Agent 1)'],
      ['agent2', 'Research (Agent 2)'],
      ['agent3', 'SEO (Agent 3)'],
      ['agent4', 'Optimization (Agent 4)'],
      ['agent5', 'Publishing (Agent 5)'],
    ]

    const sessionDurations: Record<string, ReturnType<typeof stageStats>> = {}
    for (const [key, label] of agentSlots) {
      sessionDurations[label] = stageStats(agentMs[key] ?? [])
    }

    // Total row: sum of per-agent averages (pure automation time, no queue wait)
    const agentAvgs = agentSlots
      .map(([key]) => agentMs[key] ?? [])
      .map(vals => vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null)
      .filter((v): v is number => v !== null)

    sessionDurations['Total (all agents)'] = agentAvgs.length > 0
      ? { avg: msLabel(agentAvgs.reduce((a, b) => a + b, 0)), min: '—', max: '—', count: agentAvgs.length }
      : null

    // Stage timing: avg time products spend between pipeline timestamps
    const mineToResearch: number[]    = []
    const researchToOptimize: number[] = []
    const optimizeToPublish: number[]  = []

    for (const p of products) {
      if (p.scraped_at && p.researched_at) {
        const d = new Date(p.researched_at).getTime() - new Date(p.scraped_at).getTime()
        if (d > 0 && d < 86400000 * 7) mineToResearch.push(d)   // cap at 7 days (outlier guard)
      }
      if (p.researched_at && p.optimized_at) {
        const d = new Date(p.optimized_at).getTime() - new Date(p.researched_at).getTime()
        if (d > 0 && d < 86400000 * 7) researchToOptimize.push(d)
      }
      if (p.optimized_at && p.published_at) {
        const d = new Date(p.published_at).getTime() - new Date(p.optimized_at).getTime()
        if (d > 0 && d < 86400000 * 7) optimizeToPublish.push(d)
      }
    }

    const stageTiming = [
      { stage: 'Mine → Research',    ...stageStats(mineToResearch)    ?? { avg: '—', min: '—', max: '—', count: 0 } },
      { stage: 'Research → Optimize', ...stageStats(researchToOptimize) ?? { avg: '—', min: '—', max: '—', count: 0 } },
      { stage: 'Optimize → Publish', ...stageStats(optimizeToPublish) ?? { avg: '—', min: '—', max: '—', count: 0 } },
    ]

    // Failure breakdown
    const failureBreakdown: Record<string, number> = {}
    for (const p of products) {
      if (p.status?.includes('FAILED')) {
        failureBreakdown[p.status] = (failureBreakdown[p.status] ?? 0) + 1
      }
    }

    // Throughput: products published per day, last 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const throughputMap: Record<string, number> = {}
    for (const p of products) {
      if (!p.published_at) continue
      const d = new Date(p.published_at)
      if (d.getTime() < cutoff) continue
      const key = d.toISOString().slice(0, 10)
      throughputMap[key] = (throughputMap[key] ?? 0) + 1
    }
    const throughput = Object.entries(throughputMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({
        date: new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        count,
      }))

    // Per-product timeline: last 20 completed products with at least 2 timestamps
    const productTimeline = products
      .filter(p => p.status === 'PENDING_APPROVAL' && p.scraped_at)
      .sort((a, b) => new Date(b.published_at ?? b.scraped_at ?? 0).getTime() - new Date(a.published_at ?? a.scraped_at ?? 0).getTime())
      .slice(0, 20)
      .map(p => {
        const s = p.scraped_at    ? new Date(p.scraped_at).getTime()    : null
        const r = p.researched_at ? new Date(p.researched_at).getTime() : null
        const o = p.optimized_at  ? new Date(p.optimized_at).getTime()  : null
        const pub = p.published_at  ? new Date(p.published_at).getTime()  : null
        const d = (from: number | null, to: number | null) =>
          from && to && to > from ? msLabel(to - from) : null
        const total = s && pub ? msLabel(pub - s) : null
        return {
          product_id: p.product_id,
          name: (p.cms_title || p.final_product_name || p.product_id).slice(0, 40),
          mine:     d(s, r),
          research: d(r, o),
          optimize: d(o, pub),
          total,
        }
      })

    // API cost aggregation — from run_sessions (agents 2, 3, 4 only; 1 & 5 don't use OpenAI)
    const costByAgent: Record<string, { totalUsd: number; totalTokens: number; sessions: number; productsSucceeded: number }> = {}
    for (const s of sessions) {
      if (s.status !== 'completed') continue
      const costUsd    = s.estimated_cost_usd ?? 0
      const totTokens  = s.total_tokens ?? 0
      if (!costUsd && !totTokens) continue
      if (!costByAgent[s.agent]) costByAgent[s.agent] = { totalUsd: 0, totalTokens: 0, sessions: 0, productsSucceeded: 0 }
      costByAgent[s.agent].totalUsd          += costUsd
      costByAgent[s.agent].totalTokens       += totTokens
      costByAgent[s.agent].sessions          += 1
      costByAgent[s.agent].productsSucceeded += s.products_succeeded ?? 0
    }
    const grandTotalUsd = Object.values(costByAgent).reduce((sum, v) => sum + v.totalUsd, 0)
    const grandTotalProds = Object.values(costByAgent).reduce((sum, v) => sum + v.productsSucceeded, 0)
    const costs = {
      byAgent: costByAgent,
      totalUsd: Math.round(grandTotalUsd * 10000) / 10000,
      avgPerProduct: grandTotalProds > 0 ? Math.round((grandTotalUsd / grandTotalProds) * 100000) / 100000 : 0,
    }

    return NextResponse.json({ stageCounts, sessionDurations, stageTiming, productTimeline, failureBreakdown, throughput, costs })
  } catch (err) {
    console.error('[/api/reports/analytics]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
