'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { Product, RunSession } from '@/types'
import ReviewModal from '@/components/ReviewModal'
import ProductCard from '@/components/ProductCard'
import ProductDetail from '@/components/ProductDetail'
import Topbar from '@/components/Topbar'
import Link from 'next/link'

// ── Constants ────────────────────────────────────────────────────────────────
const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? 'dewbp3mcn'

const AGENT_INFO = [
  { key: 'agent1', num: 1, name: 'Miner',     runLabel: 'Run Miner',     triggerStatus: 'READY_FOR_SCRAPE'   },
  { key: 'agent2', num: 2, name: 'Architect',  runLabel: 'Run Architect', triggerStatus: 'READY_FOR_RESEARCH' },
  { key: 'agent3', num: 3, name: 'Voice',      runLabel: 'Run Voice',     triggerStatus: 'READY_FOR_SEO'      },
  { key: 'agent4', num: 4, name: 'Optimizer',  runLabel: 'Run Optimizer', triggerStatus: 'READY_FOR_PUBLISH'  },
  { key: 'agent5', num: 5, name: 'Publisher',  runLabel: 'Run Publisher', triggerStatus: 'PUBLISHED'          },
] as const

const AGENT_COLORS = ['#0D9488', '#D97706', '#16A34A', '#4F46E5', '#14B8A6']
const AGENT_RADII  = [20, 30, 40, 50, 60]  // Miner → Publisher

const INTEGRATIONS = [
  { initials: 'SB', name: 'Supabase',      sub: 'Database'      },
  { initials: 'CL', name: 'Cloudinary',    sub: 'Image CDN'     },
  { initials: 'AI', name: 'OpenAI GPT-4o', sub: 'Vision & copy' },
  { initials: 'SP', name: 'SerpAPI',       sub: 'Google Lens'   },
  { initials: 'WC', name: 'WooCommerce',   sub: 'REST API'      },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseLogTimestamp(line: string): number | null {
  const m = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+\]/)
  if (!m) return null
  return new Date(m[1].replace(' ', 'T')).getTime()
}

function formatMs(ms: number): string {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (days > 0)  return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0)  return `${mins}m ago`
  return 'just now'
}

function stripLogPrefix(raw: string): string {
  // Actual format: [AGENT_N] [2026-03-20 22:16:52,453] [INFO] message
  return raw.replace(/^\[AGENT_\d+\]\s*\[[\d\-: ,]+\]\s*\[\w+\]\s*/i, '').trim()
}

function isLogNoise(line: string): boolean {
  return /HTTP\/1\.\d|PATCH\s|GET\s|POST\s|\bTraceback\b|urllib|httpx|\.json(\?|$)|^=+$|^-+$/i.test(line)
}

function radialDash(pct: number, r: number): string {
  const circ = 2 * Math.PI * r
  return `${(circ * pct).toFixed(1)} ${circ.toFixed(1)}`
}

function cloudinaryUrl(publicId: string, size = 120): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_${size},h_${size},c_fill/${publicId}`
}

// ── Play icon ────────────────────────────────────────────────────────────────
function PlayIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2 2l9 5-9 5V2z" fill="currentColor"/>
    </svg>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Overview() {
  const [products, setProducts]   = useState<Product[]>([])
  const [sessions, setSessions]   = useState<RunSession[]>([])
  const [loading, setLoading]     = useState(true)
  const [logLines, setLogLines]   = useState<string[]>([])
  const [reviewProduct, setReview] = useState<Product | null>(null)
  const [detailProduct, setDetail] = useState<Product | null>(null)
  const [running, setRunning]             = useState<Record<string, boolean>>({})
  const [forcedStopped, setForcedStopped] = useState<Record<string, boolean>>({})
  const [agentStartedAt, setAgentStartedAt] = useState<Record<string, number>>({})
  const [toast, setToast]                 = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = useMemo(() => createClient(), [])

  function showToast(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  // ── Derived counts ─────────────────────────────────────────────────────────
  const totalCount = products.length

  const wpDraftCount = useMemo(() =>
    products.filter(p => p.status === 'PENDING_APPROVAL').length,
  [products])

  const automatedCount = useMemo(() =>
    products.filter(p => ['PENDING_APPROVAL', 'LIVE', 'COMPLETE'].includes(p.status ?? '')).length,
  [products])

  const agentQueues = useMemo(() => [
    products.filter(p => ['READY_FOR_SCRAPE', 'SCRAPING'].includes(p.status ?? '')).length,
    products.filter(p => ['READY_FOR_RESEARCH', 'RESEARCHING'].includes(p.status ?? '')).length,
    products.filter(p => ['READY_FOR_SEO', 'WRITING_SEO'].includes(p.status ?? '')).length,
    products.filter(p => ['READY_FOR_PUBLISH', 'OPTIMIZING'].includes(p.status ?? '')).length,
    products.filter(p => ['PUBLISHED', 'PUBLISHING'].includes(p.status ?? '')).length,
  ], [products])

  const needsReviewItems = useMemo(() =>
    products.filter(p => p.status === 'NEEDS_REVIEW').slice(0, 3),
  [products])

  // agentRunning[i] = true when DB has claiming rows AND user hasn't manually stopped that agent
  const agentRunning = useMemo(() => [
    products.some(p => p.status === 'SCRAPING')     && !forcedStopped['agent1'],
    products.some(p => p.status === 'RESEARCHING')  && !forcedStopped['agent2'],
    products.some(p => p.status === 'WRITING_SEO')  && !forcedStopped['agent3'],
    products.some(p => p.status === 'OPTIMIZING')   && !forcedStopped['agent4'],
    products.some(p => p.status === 'PUBLISHING')   && !forcedStopped['agent5'],
  ], [products, forcedStopped])

  const isPipelineRunning = agentRunning.some(Boolean)
  const isPipelineQueued  = agentQueues.some(c => c > 0)

  // Active agent: prefer the most advanced one currently running (last true = highest pipeline position)
  // Falls back to highest queue count if no agent is claiming rows
  const activeAgentIdx = useMemo(() => {
    let runIdx = -1
    for (let i = agentRunning.length - 1; i >= 0; i--) {
      if (agentRunning[i]) { runIdx = i; break }
    }
    if (runIdx >= 0) return runIdx
    let maxIdx = -1, maxCount = 0
    agentQueues.forEach((c, i) => { if (c > maxCount) { maxCount = c; maxIdx = i } })
    return maxIdx
  }, [agentRunning, agentQueues])

  // Last active time (most recent ended_at across all sessions)
  const lastActiveAt = useMemo(() => {
    const times = sessions.filter(s => s.ended_at).map(s => new Date(s.ended_at!).getTime())
    return times.length ? Math.max(...times) : null
  }, [sessions])

  // ── Last run duration — sum of actual agent durations, idle gaps excluded ───
  const { lastRunMs, lastRunProducts } = useMemo(() => {
    if (!sessions.length) return { lastRunMs: null, lastRunProducts: 0 }
    const withEnd = sessions.filter(s => s.ended_at && s.duration_seconds)
    if (!withEnd.length) return { lastRunMs: null, lastRunProducts: 0 }
    const latestEnd = Math.max(...withEnd.map(s => new Date(s.ended_at!).getTime()))
    const WINDOW = 2 * 60 * 60 * 1000
    const batch = withEnd.filter(s => {
      const st = new Date(s.started_at).getTime()
      const et = new Date(s.ended_at!).getTime()
      return Math.abs(st - latestEnd) < WINDOW || Math.abs(et - latestEnd) < WINDOW
    })
    if (!batch.length) return { lastRunMs: null, lastRunProducts: 0 }
    // Sum actual agent run time — no idle gaps between agents
    const totalMs = batch.reduce((sum, s) => sum + (s.duration_seconds! * 1000), 0)
    // Use max products_succeeded across agents — avoids counting same products multiple times
    const prods   = Math.max(...batch.map(s => s.products_succeeded ?? 0))
    return { lastRunMs: totalMs, lastRunProducts: prods }
  }, [sessions])

  // ── Per-agent success rates (from sessions) ────────────────────────────────
  const agentSuccessRates = useMemo(() =>
    AGENT_INFO.map(({ key }) => {
      const agg = sessions.filter(s => s.agent === key && s.status === 'completed')
      const succeeded = agg.reduce((sum, s) => sum + (s.products_succeeded ?? 0), 0)
      const attempted = agg.reduce((sum, s) => sum + (s.products_attempted ?? 0), 0)
      return attempted > 0 ? Math.round((succeeded / attempted) * 100) : null
    }),
  [sessions])

  const avgSuccessRate = useMemo(() => {
    const valid = agentSuccessRates.filter((r): r is number => r !== null)
    return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null
  }, [agentSuccessRates])

  // ── Per-agent speed (avg ms/product) ──────────────────────────────────────
  const agentSpeeds = useMemo(() =>
    AGENT_INFO.map(({ key }) => {
      const agg = sessions.filter(s => s.agent === key && s.status === 'completed' && (s.products_succeeded ?? 0) > 0 && s.duration_seconds)
      if (!agg.length) return null
      const avgMs = agg.reduce((sum, s) => sum + (s.duration_seconds! / s.products_succeeded) * 1000, 0) / agg.length
      return Math.round(avgMs)
    }),
  [sessions])

  const totalSpeedMs = useMemo(() => {
    const valid = agentSpeeds.filter((s): s is number => s !== null)
    return valid.length === 5 ? valid.reduce((a, b) => a + b, 0) : null
  }, [agentSpeeds])

  const maxSpeedMs = Math.max(...agentSpeeds.filter((s): s is number => s !== null), 1)

  // ── Recent products (last 7 by updated_at) ─────────────────────────────────
  const recentProducts = useMemo(() =>
    [...products]
      .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
      .slice(0, 7),
  [products])

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [res, sessRes] = await Promise.all([
        fetch('/api/data'),
        fetch('/api/reports/sessions'),
      ])
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setProducts(d.products ?? [])
      if (sessRes.ok) {
        const sd = await sessRes.json()
        setSessions(sd.sessions ?? [])
      }
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel('overview-rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, () => loadData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'products' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadData, supabase])

  // ── Log polling (active agent only) ───────────────────────────────────────
  useEffect(() => {
    if (activeAgentIdx < 0) { setLogLines([]); return }
    const key = `agent${activeAgentIdx + 1}`
    const startedAt = agentStartedAt[key] ?? 0
    let cancelled = false

    const DONE_PATTERN = /Run session completed|BATCH PROCESSING COMPLETE|PUBLISH COMPLETE|No \w+ rows found|nothing to process/i

    const poll = async () => {
      try {
        const res = await fetch(`/api/logs?agent=${key}`)
        if (!res.ok || cancelled) return
        const { lines } = await res.json() as { lines: string[] }

        // Only consider lines from this run (after startedAt) for done detection
        const currentRunLines = startedAt > 0
          ? lines.filter(l => { const ts = parseLogTimestamp(l); return ts === null || ts >= startedAt })
          : lines

        if (currentRunLines.some(l => DONE_PATTERN.test(l))) {
          if (!cancelled) setForcedStopped(s => ({ ...s, [key]: true }))
        }

        const cleaned = currentRunLines
          .filter(l => (l.includes('[INFO]') || l.includes('[WARNING]')) && !isLogNoise(l))
          .map(stripLogPrefix)
          .filter(l => l.length > 0 && !/^=+$/.test(l) && !/^-+$/.test(l))
          .slice(-4)
        if (!cancelled) setLogLines(cleaned)
      } catch { /* silent */ }
    }

    poll()
    const id = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeAgentIdx, agentStartedAt])

  // ── Run / stop agent ───────────────────────────────────────────────────────
  const runAgent = useCallback(async (agentKey: string) => {
    // Clear forced-stopped and record start time so done-detection ignores old log lines
    setForcedStopped(s => ({ ...s, [agentKey]: false }))
    setAgentStartedAt(s => ({ ...s, [agentKey]: Date.now() }))
    setRunning(r => ({ ...r, [agentKey]: true }))
    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentKey }),
      })
      if (!res.ok) showToast('Failed to start agent', 'err')
    } catch { showToast('Failed to start agent', 'err') } finally {
      setRunning(r => ({ ...r, [agentKey]: false }))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopAgent = useCallback(async (agentKey: string) => {
    // Immediately mark as stopped in UI — don't wait for DB claiming rows to clear
    setForcedStopped(s => ({ ...s, [agentKey]: true }))
    try {
      await fetch('/api/stop-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentKey }),
      })
      showToast('Stop signal sent — agent will finish its current product then halt', 'ok')
    } catch {
      // Revert if the API call failed
      setForcedStopped(s => ({ ...s, [agentKey]: false }))
      showToast('Failed to send stop signal', 'err')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const runFullPipeline = useCallback(async () => {
    setForcedStopped({})
    for (const { key } of AGENT_INFO) {
      await runAgent(key)
    }
  }, [runAgent])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{`
        @keyframes blink {
          0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(22,163,74,0.4)}
          50%{opacity:0.6;box-shadow:0 0 0 4px rgba(22,163,74,0)}
        }
        @keyframes chipPulse {
          0%,100%{box-shadow:0 0 0 3px rgba(13,148,136,0.12)}
          50%{box-shadow:0 0 0 6px rgba(13,148,136,0.04)}
        }
        @keyframes connFlow {
          0%{left:-5px;opacity:0}10%{opacity:1}90%{opacity:1}100%{left:105%;opacity:0}
        }
        @keyframes ovFade{to{opacity:1;transform:translateY(0)}}
        .ov-row{opacity:0;transform:translateY(8px);animation:ovFade 0.4s ease forwards}
        .ov-row:nth-child(1){animation-delay:0.04s}
        .ov-row:nth-child(2){animation-delay:0.08s}
        .ov-row:nth-child(3){animation-delay:0.12s}
        .ov-row:nth-child(4){animation-delay:0.16s}
        .ov-row:nth-child(5){animation-delay:0.20s}
        .hero-card-wrap{transition:box-shadow 0.15s,border-color 0.15s,transform 0.15s}
        .hero-card-wrap:hover{box-shadow:var(--shadow-md)!important;border-color:var(--border-md)!important;transform:translateY(-1px)}
        .metric-wrap{transition:box-shadow 0.15s,border-color 0.15s,transform 0.15s}
        .metric-wrap:hover{box-shadow:var(--shadow-md)!important;border-color:var(--border-md)!important;transform:translateY(-1px)}
        .product-card-wrap{transition:box-shadow 0.15s,border-color 0.15s,transform 0.15s}
        .product-card-wrap:hover{box-shadow:var(--shadow-md)!important;border-color:rgba(13,148,136,0.25)!important;transform:translateY(-2px)}
        .agent-chip-wrap{transition:all 0.15s;cursor:pointer}
        .agent-chip-wrap:hover:not(.chip-active){border-color:var(--teal-glow)!important;background:var(--teal-dim)!important}
        .int-row-wrap{transition:background 0.13s;cursor:pointer}
        .int-row-wrap:hover{background:var(--surface-2)!important}
        .alert-card-wrap{transition:transform 0.13s,box-shadow 0.13s;cursor:pointer}
        .alert-card-wrap:hover{transform:translateY(-1px);box-shadow:var(--shadow-md)}
        .speed-bar-fill-anim{transition:width 0.6s ease}
      `}</style>

      <Topbar title="Overview" onRefresh={loadData} refreshing={loading} />

      <div style={{ padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── ROW 1: Two hero cards ─────────────────────────────────────────── */}
        <div className="ov-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Total Products */}
          <div className="hero-card-wrap" style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '26px 28px',
            boxShadow: 'var(--shadow-card)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0', background: 'linear-gradient(90deg,var(--teal),var(--teal-mid))' }} />
            <div style={{ position: 'absolute', bottom: -30, right: -20, width: 120, height: 120, borderRadius: '50%', background: 'var(--teal)', opacity: 0.04 }} />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 13, background: 'var(--teal-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="23" height="23" viewBox="0 0 22 22" fill="none" style={{ color: 'var(--teal)' }}>
                  <rect x="2" y="2" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6"/>
                  <path d="M7 2v18M15 2v18M2 8h18M2 14h18" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.9px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 7 }}>
                  Total Products
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 46, fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
                  {totalCount}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, padding: '3px 9px', borderRadius: 6, background: 'var(--teal-dim)', color: 'var(--teal)', border: '1px solid var(--teal-glow)' }}>
                    {agentQueues[0]} queued
                  </span>
                  {needsReviewItems.length > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, padding: '3px 9px', borderRadius: 6, background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid rgba(217,119,6,0.2)' }}>
                      {needsReviewItems.length} review
                    </span>
                  )}
                  {agentQueues[1] > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, padding: '3px 9px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      {agentQueues[1]} researching
                    </span>
                  )}
                </div>
              </div>
              <svg width="88" height="40" viewBox="0 0 88 40" fill="none" style={{ flexShrink: 0, alignSelf: 'flex-end', opacity: 0.8 }}>
                <polyline points="0,32 18,26 36,28 54,16 72,20 88,10" stroke="var(--teal)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <polygon points="0,32 18,26 36,28 54,16 72,20 88,10 88,40 0,40" fill="url(#tg)"/>
                <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--teal)" stopOpacity="0.15"/><stop offset="100%" stopColor="var(--teal)" stopOpacity="0"/></linearGradient></defs>
              </svg>
            </div>
          </div>

          {/* WordPress Draft */}
          <div className="hero-card-wrap" style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '26px 28px',
            boxShadow: 'var(--shadow-card)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0', background: 'linear-gradient(90deg,var(--wp-blue),#6366F1)' }} />
            <div style={{ position: 'absolute', bottom: -30, right: -20, width: 120, height: 120, borderRadius: '50%', background: 'var(--wp-blue)', opacity: 0.04 }} />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 13, background: 'var(--wp-blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="23" height="23" viewBox="0 0 22 22" fill="none" style={{ color: 'var(--wp-blue)' }}>
                  <rect x="2" y="3" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6"/>
                  <path d="M2 8h18" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M7 12h8M7 15h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <circle cx="5" cy="5.5" r="1" fill="currentColor" opacity="0.5"/>
                  <circle cx="8" cy="5.5" r="1" fill="currentColor" opacity="0.5"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.9px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 7 }}>
                  Published Products <em style={{ fontStyle: 'italic', letterSpacing: 0 }}>(WordPress Draft)</em>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 46, fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--wp-blue)' }}>
                  {wpDraftCount}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, padding: '3px 9px', borderRadius: 6, background: 'var(--wp-blue-dim)', color: 'var(--wp-blue)', border: '1px solid rgba(56,88,233,0.18)' }}>
                    Pending HITL review
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, padding: '3px 9px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                    Price + details needed
                  </span>
                </div>
              </div>
              <svg width="88" height="40" viewBox="0 0 88 40" fill="none" style={{ flexShrink: 0, alignSelf: 'flex-end', opacity: 0.8 }}>
                <polyline points="0,36 18,30 36,32 54,20 72,18 88,12" stroke="var(--wp-blue)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <polygon points="0,36 18,30 36,32 54,20 72,18 88,12 88,40 0,40" fill="url(#wg)"/>
                <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--wp-blue)" stopOpacity="0.12"/><stop offset="100%" stopColor="var(--wp-blue)" stopOpacity="0"/></linearGradient></defs>
              </svg>
            </div>
          </div>

        </div>

        {/* ── ROW 2: Three metric cards ─────────────────────────────────────── */}
        <div className="ov-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>

          {/* Products Automated */}
          <div className="metric-wrap" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--success-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--success)' }}>
                <path d="M10 2a8 8 0 100 16A8 8 0 0010 2z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Products Automated</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.8px', color: 'var(--text-primary)', lineHeight: 1 }}>{automatedCount}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>Completed end-to-end</div>
            </div>
          </div>

          {/* Last Run Duration */}
          <div className="metric-wrap" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--teal-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--teal)' }}>
                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 6.5v3.75l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Last Run Duration</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.8px', color: 'var(--text-primary)', lineHeight: 1 }}>
                {lastRunMs != null ? formatMs(lastRunMs) : '—'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                {lastRunMs != null ? `Agent time only · ${automatedCount} products` : 'No completed runs yet'}
              </div>
            </div>
          </div>

          {/* Human Labor Saved */}
          <div className="metric-wrap" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--warning-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--warning)' }}>
                <path d="M10 18s-7-5.5-7-10a7 7 0 0114 0c0 4.5-7 10-7 10z" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="10" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Human Labor Saved</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.8px', color: 'var(--text-primary)', lineHeight: 1 }}>
                {automatedCount > 0 ? `~${Math.round(automatedCount * 18 / 60)}h` : '—'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>18 min/product avg · {automatedCount} products</div>
            </div>
          </div>

        </div>

        {/* ── ROW 3: Full Pipeline card ────────────────────────────────────── */}
        <div className="ov-row" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>

          {/* Pipeline header */}
          <div style={{
            padding: '16px 24px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(to right, rgba(13,148,136,0.03), transparent)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: isPipelineRunning ? 'var(--success)' : 'var(--text-muted)', animation: isPipelineRunning ? 'blink 1.8s ease-in-out infinite' : 'none' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Full Pipeline</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· 5 agents · auto-advancing</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {isPipelineRunning && activeAgentIdx >= 0 && (
                <button
                  onClick={() => stopAgent(AGENT_INFO[activeAgentIdx].key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, background: 'var(--error-dim)', border: '1px solid var(--error-border)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.13s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#FEE2E2' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--error-dim)' }}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1.5"/></svg>
                  Stop
                </button>
              )}
              <button
                onClick={runFullPipeline}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderRadius: 9, background: 'var(--teal)', border: '1px solid var(--teal)', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.13s', boxShadow: 'var(--shadow-teal)', letterSpacing: '0.1px' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#0F766E'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--teal)'; e.currentTarget.style.transform = 'translateY(0)' }}
              >
                <PlayIcon size={14} />
                Run Full Pipeline
              </button>
            </div>
          </div>

          {/* Agent flow */}
          <div style={{ padding: '22px 24px 20px', display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto' }}>

            {AGENT_INFO.map(({ key, num, name, runLabel }, i) => {
              const count      = agentQueues[i]
              const isActive   = count > 0
              const isArch     = i === 1
              const isRunning  = running[key]
              const isClaiming = agentRunning[i]  // has rows in claiming status (process actively running)

              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                  {/* Agent chip */}
                  <div
                    className={`agent-chip-wrap${isActive ? ' chip-active' : ''}`}
                    style={{
                      background: isActive ? 'var(--teal-dim)' : 'var(--surface-2)',
                      border: `1.5px solid ${isActive ? 'var(--teal)' : 'var(--border)'}`,
                      borderRadius: 12, padding: '14px 16px',
                      flex: 1, textAlign: 'center',
                      animation: isActive ? 'chipPulse 2.2s ease-in-out infinite' : 'none',
                      position: 'relative',
                    }}
                  >
                    {isArch && needsReviewItems.length > 0 && (
                      <div style={{ position: 'absolute', top: -8, right: -8, background: 'var(--warning)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 500, padding: '2px 7px', borderRadius: 8 }}>
                        {needsReviewItems.length} REVIEW
                      </div>
                    )}
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', color: isActive ? 'var(--teal)' : 'var(--text-muted)', marginBottom: 3 }}>
                      Agent {String(num).padStart(2, '0')}
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                      {name}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                      <button
                        onClick={() => runAgent(key)}
                        disabled={isRunning}
                        style={{
                          flex: 1, padding: '5px', borderRadius: 7,
                          border: `1px solid ${isActive ? 'var(--teal)' : 'var(--border-md)'}`,
                          background: isActive ? 'var(--teal)' : 'var(--surface)',
                          color: isActive ? '#fff' : 'var(--text-muted)',
                          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
                          cursor: isRunning ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          opacity: isRunning ? 0.6 : 1, transition: 'all 0.13s',
                        }}
                      >
                        <PlayIcon size={10} />
                        {isRunning ? 'Running…' : runLabel}
                      </button>
                      {isClaiming && (
                        <button
                          onClick={() => stopAgent(key)}
                          title={`Stop ${name}`}
                          style={{
                            padding: '5px 7px', borderRadius: 7,
                            border: '1px solid var(--error-border)',
                            background: 'var(--error-dim)', color: 'var(--error)',
                            cursor: 'pointer', transition: 'all 0.13s', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>
                        </button>
                      )}
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, lineHeight: 1, color: isActive ? 'var(--teal)' : 'var(--text-muted)' }}>
                      {count}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
                      queued
                    </div>
                  </div>

                  {/* Connector */}
                  {i < 4 && (
                    <div style={{ width: 36, flexShrink: 0, display: 'flex', alignItems: 'center', paddingBottom: 20 }}>
                      <div style={{ width: '100%', height: 1.5, background: 'var(--border-md)', position: 'relative', overflow: 'hidden' }}>
                        {isActive && (
                          <>
                            <div style={{ position: 'absolute', width: 5, height: 5, borderRadius: '50%', background: 'var(--teal)', top: '50%', transform: 'translateY(-50%)', animation: 'connFlow 2s linear infinite', opacity: 0 }} />
                            <div style={{ position: 'absolute', width: 5, height: 5, borderRadius: '50%', background: 'var(--teal)', top: '50%', transform: 'translateY(-50%)', animation: 'connFlow 2s linear infinite', animationDelay: '0.67s', opacity: 0 }} />
                            <div style={{ position: 'absolute', width: 5, height: 5, borderRadius: '50%', background: 'var(--teal)', top: '50%', transform: 'translateY(-50%)', animation: 'connFlow 2s linear infinite', animationDelay: '1.34s', opacity: 0 }} />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Last connector → Published */}
            <div style={{ width: 36, flexShrink: 0, display: 'flex', alignItems: 'center', paddingBottom: 20 }}>
              <div style={{ width: '100%', height: 1.5, background: 'rgba(22,163,74,0.35)' }} />
            </div>

            {/* Published endpoint */}
            <div style={{ flexShrink: 0, textAlign: 'center', padding: '0 10px 20px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--success)', lineHeight: 1 }}>
                {wpDraftCount}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', color: 'var(--success)', letterSpacing: '0.8px', marginTop: 3, opacity: 0.9 }}>
                Published
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>WP Draft</div>
            </div>

          </div>

          {/* Pipeline status bar */}
          <div style={{ padding: '11px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 500, color: isPipelineRunning ? 'var(--success)' : isPipelineQueued ? 'var(--teal)' : 'var(--text-muted)' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: isPipelineRunning ? 'var(--success)' : isPipelineQueued ? 'var(--teal)' : 'var(--text-muted)', animation: isPipelineRunning ? 'blink 1.8s ease-in-out infinite' : 'none' }} />
              {isPipelineRunning ? 'Pipeline is running' : isPipelineQueued ? 'Pipeline queued — waiting for agent' : 'Pipeline idle'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              {lastRunMs != null
                ? `Last run: ${formatMs(lastRunMs)}${automatedCount > 0 ? ` · ${automatedCount} products` : ''}`
                : lastActiveAt != null
                ? `Last active: ${timeAgo(lastActiveAt)}`
                : 'No runs yet'}
            </div>
          </div>

          {/* NEEDS_REVIEW alert cards */}
          {needsReviewItems.length > 0 && (
            <>
              <div style={{ padding: '16px 24px 8px', fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warning)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, padding: '1px 7px', borderRadius: 8, background: 'var(--warning)', color: '#fff' }}>{needsReviewItems.length}</span>
                Needs Review — click to inspect product
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, padding: '0 24px 20px' }}>
                {needsReviewItems.map(p => {
                  const initials = (p.final_product_name ?? p.english_name_draft ?? '??').slice(0, 2).toUpperCase()
                  return (
                    <div
                      key={p.product_id}
                      className="alert-card-wrap"
                      onClick={() => setReview(p)}
                      style={{ borderRadius: 10, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--warning-dim)', border: '1px solid rgba(217,119,6,0.2)' }}
                    >
                      <div style={{ width: 36, height: 36, borderRadius: 7, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden' }}>
                        {p.main_image_id ? (
                          <img src={cloudinaryUrl(p.main_image_id, 72)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                        ) : initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.final_product_name ?? p.english_name_draft ?? 'Unknown Product'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          Low confidence ID · Agent 02
                        </div>
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: 14, flexShrink: 0 }}>→</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Live logs — active agent only */}
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', animation: 'blink 1.8s ease-in-out infinite' }} />
                Status · Live Agent Logs
              </div>
              {isPipelineRunning && activeAgentIdx >= 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: 'var(--teal-dim)', color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500, padding: '2px 9px', borderRadius: 5, letterSpacing: '0.3px' }}>
                    AGENT {String(activeAgentIdx + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {AGENT_INFO[activeAgentIdx].name} — currently running
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--success)', fontWeight: 500 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', animation: 'blink 1.8s ease-in-out infinite' }} />
                    Running
                  </div>
                </div>
              ) : (
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Activity</span>
              )}
            </div>

            {!isPipelineRunning ? (
              <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)' }}>
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {isPipelineQueued ? 'Agents queued — no process is currently running' : 'Pipeline is idle'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {lastActiveAt != null ? `Last active ${timeAgo(lastActiveAt)}` : 'Add products and run an agent to start'}
                  </div>
                </div>
              </div>
            ) : logLines.length > 0 ? (
              <div style={{ padding: '13px 24px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {logLines.map((text, idx) => {
                  const isLast = idx === logLines.length - 1
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: isLast ? 'var(--teal)' : 'var(--success)', flexShrink: 0, marginTop: 4 }} />
                      <div style={{ flex: 1 }}>{text}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }}>
                        {isLast ? 'now' : `${(logLines.length - 1 - idx) * 30}s ago`}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ padding: '16px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>Waiting for log output…</div>
            )}
          </div>

        </div>

        {/* ── ROW 4: Radial chart + Agent Speed + Integrations ─────────────── */}
        <div className="ov-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 280px', gap: 16 }}>

          {/* Agent Performance radial chart */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M8 4v4l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Agent Performance
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {avgSuccessRate != null ? `${avgSuccessRate}% avg success` : 'No data yet'}
              </span>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 20 }}>
              {/* Radial rings — one bar per agent, stacked vertically when no session data */}
              {avgSuccessRate == null ? (
                /* No session data yet — show placeholder bars */
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {AGENT_INFO.map(({ name }, i) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: AGENT_COLORS[i], flexShrink: 0 }} />
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', width: 62, flexShrink: 0 }}>{name}</div>
                      <div style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: '0%', height: '100%', background: AGENT_COLORS[i], borderRadius: 3 }} />
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', width: 24, textAlign: 'right', flexShrink: 0 }}>—</div>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>No run history yet</div>
                </div>
              ) : (
                /* Has data — concentric rings */
                <>
                  <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
                    <svg width="140" height="140" viewBox="0 0 140 140">
                      {AGENT_RADII.map((r, i) => {
                        const pct = (agentSuccessRates[i] ?? 0) / 100
                        return (
                          <g key={i}>
                            <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8"/>
                            <circle cx="70" cy="70" r={r} fill="none" stroke={AGENT_COLORS[i]} strokeWidth="8"
                              strokeDasharray={radialDash(pct, r)}
                              strokeLinecap="round" transform="rotate(-90 70 70)"
                              style={{ opacity: agentSuccessRates[i] == null ? 0.2 : 1 }}/>
                          </g>
                        )
                      })}
                    </svg>
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                        {avgSuccessRate}%
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>avg rate</div>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    {AGENT_INFO.map(({ name }, i) => (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: AGENT_COLORS[i], flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{name}</span>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                          {agentSuccessRates[i] != null ? `${agentSuccessRates[i]}%` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Agent Speed bars */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12V6l4-4 4 4v6M10 12V9h4v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Agent Speed
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>avg per product</span>
            </div>
            <div style={{ padding: '20px 24px' }}>
              {AGENT_INFO.map(({ name }, i) => {
                const ms  = agentSpeeds[i]
                const pct = ms ? Math.min((ms / maxSpeedMs) * 100, 100) : 0
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ width: 70, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{name}</div>
                    <div style={{ flex: 1, height: 5, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div className="speed-bar-fill-anim" style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'var(--teal)' }} />
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', width: 44, textAlign: 'right', flexShrink: 0 }}>
                      {ms ? formatMs(ms) : '—'}
                    </div>
                  </div>
                )
              })}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 0', borderTop: '1px solid var(--border-md)', marginTop: 4 }}>
                <div style={{ width: 70, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flexShrink: 0 }}>Total</div>
                <div style={{ flex: 1 }} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--teal)', width: 44, textAlign: 'right', flexShrink: 0 }}>
                  {totalSpeedMs ? formatMs(totalSpeedMs) : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Integrations */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zM2 8h12M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M8 2c1.5 2 2.5 3.8 2.5 6s-1 4-2.5 6" stroke="currentColor" strokeWidth="1.4"/></svg>
                Integrations
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--success)', fontWeight: 500 }}>5/5 online</span>
            </div>
            {INTEGRATIONS.map(({ initials, name, sub }, i) => (
              <div
                key={name}
                className="int-row-wrap"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: i < INTEGRATIONS.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
                  </div>
                </div>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
              </div>
            ))}
          </div>

        </div>

        {/* ── ROW 5: Recent Products ───────────────────────────────────────── */}
        <div className="ov-row">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M5 1v14M1 5h14M1 9h14M1 13h14" stroke="currentColor" strokeWidth="1.1" opacity="0.5"/></svg>
              Recent Products
            </div>
            <Link href="/pipeline" style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 500 }}>
              View all in Pipeline →
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12 }}>
            {recentProducts.map(p => (
              <ProductCard
                key={p.product_id}
                product={p}
                onDetail={setDetail}
                onReview={setReview}
              />
            ))}
            {recentProducts.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No products yet — add a Yupoo URL to get started
              </div>
            )}
          </div>
        </div>

      </div>

      {reviewProduct && (
        <ReviewModal product={reviewProduct} onClose={() => setReview(null)} onRefresh={loadData} />
      )}
      {detailProduct && (
        <ProductDetail product={detailProduct} onClose={() => setDetail(null)} onDelete={() => { setDetail(null); loadData() }} />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
          background: toast.type === 'ok' ? 'var(--success-dim)' : 'var(--error-dim)',
          border: `1px solid ${toast.type === 'ok' ? 'var(--success-border)' : 'var(--error-border)'}`,
          color: toast.type === 'ok' ? 'var(--success)' : 'var(--error)',
          borderRadius: 10, padding: '11px 18px',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-md)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'ovFade 0.2s ease',
        }}>
          {toast.type === 'ok'
            ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          }
          {toast.msg}
        </div>
      )}
    </div>
  )
}
