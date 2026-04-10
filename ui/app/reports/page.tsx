'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RunSession } from '@/types'
import Topbar from '@/components/Topbar'
import StatCard from '@/components/StatCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StageStat { avg: string; min: string; max: string; count: number }
interface StageTiming { stage: string; avg: string; min: string; max: string; count: number }
interface CloudinaryUsage {
  storage_fmt: string; bandwidth_fmt: string; resources: number
  storage_bytes: number; bandwidth_bytes: number; plan: string | null
}
interface ProductTimeline {
  product_id: string; name: string
  mine: string | null; research: string | null; optimize: string | null; total: string | null
}
interface CostByAgent {
  totalUsd: number; totalTokens: number; sessions: number; productsSucceeded: number
}
interface AnalyticsData {
  stageCounts:       Record<string, number>
  sessionDurations:  Record<string, StageStat | null>
  stageTiming:       StageTiming[]
  productTimeline:   ProductTimeline[]
  failureBreakdown:  Record<string, number>
  throughput:        { date: string; count: number }[]
  costs?:            { byAgent: Record<string, CostByAgent>; totalUsd: number; avgPerProduct: number }
}

const FUNNEL_STAGES = [
  { status: 'READY_FOR_SCRAPE',   label: 'Queued'       },
  { status: 'READY_FOR_RESEARCH', label: 'Scraped'      },
  { status: 'NEEDS_REVIEW',       label: 'Needs Review' },
  { status: 'READY_FOR_SEO',      label: 'Identified'   },
  { status: 'READY_FOR_PUBLISH',  label: 'SEO Done'     },
  { status: 'PUBLISHED',          label: 'Published'    },
  { status: 'PENDING_APPROVAL',   label: 'Pending'      },
  { status: 'LIVE',               label: 'Live'         },
]

const AGENT_LABELS: Record<string, string> = {
  agent1: 'Miner', agent2: 'Architect', agent3: 'Voice', agent4: 'Optimizer', agent5: 'Publisher',
}

function agentLabel(agent: string | null | undefined) {
  return agent ? (AGENT_LABELS[agent] ?? agent) : '—'
}

function formatDuration(secs: number | null | undefined) {
  if (!secs) return '—'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60), s = secs % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    })
  } catch { return '—' }
}

function sessionRate(s: RunSession) {
  if (!s.products_attempted) return null
  return Math.round((s.products_succeeded / s.products_attempted) * 100)
}

function rateColor(rate: number | null): string {
  if (rate == null) return 'var(--text-muted)'
  if (rate >= 90) return 'var(--success)'
  if (rate >= 50) return 'var(--warning)'
  return 'var(--error)'
}

// ---------------------------------------------------------------------------
// SessionLogs drawer
// ---------------------------------------------------------------------------
function parseLogLevel(line: string): 'ERROR' | 'WARNING' | 'INFO' {
  if (/\[ERROR\]|\[CRITICAL\]/i.test(line)) return 'ERROR'
  if (/\[WARNING\]/i.test(line))            return 'WARNING'
  return 'INFO'
}

// Python agents log Supabase exceptions as raw dict strings, e.g.:
//   ❌ Error processing XYZ: {'message': 'new row ... violates check constraint', 'code': '23514', ...}
// Extract just the human-readable 'message' value so session logs are readable.
function cleanLogLine(line: string): string {
  return line.replace(/\{'message':\s*'([^']+)'[^}]*\}/g, (_, msg) => msg)
}

function SessionLogs({ session, onClose }: { session: RunSession; onClose: () => void }) {
  const [lines, setLines]     = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL')

  useEffect(() => {
    const fromMs = new Date(session.started_at).getTime()
    const toMs   = session.ended_at ? new Date(session.ended_at).getTime() : undefined
    const url    = `/api/logs?agent=${session.agent}&from=${fromMs}${toMs ? `&to=${toMs}` : ''}`
    fetch(url).then(r => r.json()).then(d => setLines(d.lines ?? [])).catch(() => {}).finally(() => setLoading(false))
  }, [session])

  const visible = filter === 'ALL' ? lines : lines.filter(l => parseLogLevel(l) === filter)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: 800, background: 'var(--surface)', border: '1px solid var(--border-md)', borderRadius: '12px 12px 0 0', maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Session Logs</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10, fontFamily: 'var(--font-mono)' }}>
              {agentLabel(session.agent)} · {formatDateTime(session.started_at)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {(['ALL', 'INFO', 'WARNING', 'ERROR'] as const).map(l => (
              <button
                key={l}
                onClick={() => setFilter(l)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)',
                  background: filter === l ? 'var(--accent-dim)' : 'transparent',
                  color: filter === l ? 'var(--accent)' : 'var(--text-muted)',
                  border: `1px solid ${filter === l ? 'var(--accent-glow)' : 'var(--border)'}`,
                  transition: 'all 150ms ease',
                }}
              >{l}</button>
            ))}
            <button
              onClick={onClose}
              style={{
                marginLeft: 4, width: 28, height: 28,
                background: 'var(--surface-2)', border: '1px solid var(--border-md)',
                borderRadius: 6, fontSize: 14, color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 150ms ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}>Loading…</div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}>No logs found for this session.</div>
          ) : (
            visible.map((line, i) => {
              const lvl = parseLogLevel(line)
              return (
                <div key={i} style={{ color: lvl === 'ERROR' ? 'var(--error)' : lvl === 'WARNING' ? 'var(--warning)' : 'var(--text-secondary)' }}>{cleanLogLine(line)}</div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row component — hover-aware
// ---------------------------------------------------------------------------
function RunRow({ s, onLogs, onDelete }: { s: RunSession; onLogs: (s: RunSession) => void; onDelete: (id: string) => void }) {
  const [hovered, setHovered]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const rate = sessionRate(s)
  const isAnomaly = rate != null && rate < 50

  const statusStyle: React.CSSProperties =
    s.status === 'completed' ? { background: 'var(--success-dim)', color: 'var(--success)' } :
    s.status === 'failed'    ? { background: 'var(--error-dim)',   color: 'var(--error)' } :
                               { background: 'var(--accent-dim)',  color: 'var(--accent)' }

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: '1px solid var(--border)',
        background: hovered ? 'var(--surface-2)' : 'transparent',
        borderLeft: isAnomaly ? '2px solid var(--warning)' : '2px solid transparent',
        transition: 'background 120ms ease',
      }}
    >
      <td style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--text-primary)', fontSize: 13 }}>{agentLabel(s.agent)}</td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{ ...statusStyle, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, padding: '3px 9px', borderRadius: 5, display: 'inline-block' }}>
          {s.status.toUpperCase()}
        </span>
      </td>
      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{formatDateTime(s.started_at)}</td>
      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(s.duration_seconds)}</td>
      <td style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--text-secondary)', textAlign: 'right' }}>{s.products_attempted}</td>
      <td style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--success)',        textAlign: 'right' }}>{s.products_succeeded}</td>
      <td style={{ padding: '10px 14px', fontSize: 12.5, color: s.products_failed > 0 ? 'var(--error)' : 'var(--text-muted)', textAlign: 'right' }}>{s.products_failed}</td>
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600, color: rateColor(rate) }}>
          {rate != null ? `${rate}%` : '—'}
        </span>
      </td>
      <td style={{ padding: '10px 14px', opacity: hovered || confirming ? 1 : 0, transition: 'opacity 120ms ease', whiteSpace: 'nowrap' }}>
        {confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--error)' }}>Delete?</span>
            <button
              onClick={() => { setConfirming(false); onDelete(s.id) }}
              style={{
                background: 'var(--error-dim)', border: '1px solid var(--error)',
                borderRadius: 6, padding: '4px 10px', fontSize: 12,
                color: 'var(--error)', fontFamily: 'var(--font-body)',
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={{
                background: 'none', border: 'none', fontSize: 12,
                color: 'var(--text-muted)', fontFamily: 'var(--font-body)',
                cursor: 'pointer', padding: '4px 4px',
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => onLogs(s)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border-md)',
                borderRadius: 6, padding: '4px 10px', fontSize: 12,
                color: 'var(--accent)', fontFamily: 'var(--font-body)',
                opacity: 0.8, transition: 'opacity 120ms ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
            >
              Logs →
            </button>
            <button
              onClick={() => setConfirming(true)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border-md)',
                borderRadius: 6, padding: '4px 8px', fontSize: 13,
                color: 'var(--text-muted)', fontFamily: 'var(--font-body)',
                transition: 'color 120ms ease, border-color 120ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--error)'; e.currentTarget.style.borderColor = 'var(--error)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-md)' }}
            >
              ×
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ReportsPage() {
  const [tab, setTab]               = useState<'runs' | 'analytics'>('runs')
  const [sessions, setSessions]     = useState<RunSession[]>([])
  const [loading, setLoading]       = useState(true)
  const [agentFilter, setAgentFilter]   = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [openSession, setOpenSession]   = useState<RunSession | null>(null)
  const [analytics, setAnalytics]       = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [cloudinary, setCloudinary]     = useState<CloudinaryUsage | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reports/sessions')
      const d = await res.json()
      setSessions(d.sessions ?? [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const [res, cdnRes] = await Promise.all([
        fetch('/api/reports/analytics'),
        fetch('/api/reports/cloudinary'),
      ])
      const d   = await res.json()
      const cdn = await cdnRes.json()
      if (!d.error)   setAnalytics(d)
      if (!cdn.error) setCloudinary(cdn)
    } catch { /* ignore */ }
    finally { setAnalyticsLoading(false) }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])
  useEffect(() => { if (tab === 'analytics' && !analytics) loadAnalytics() }, [tab, analytics, loadAnalytics])

  const completed     = sessions.filter(s => s.status === 'completed')
  const failedSess    = sessions.filter(s => s.status === 'failed')
  const totalBuilt    = sessions.reduce((sum, s) => sum + s.products_succeeded, 0)
  const avgRate       = completed.length
    ? Math.round(completed.reduce((sum, s) => sum + (sessionRate(s) ?? 0), 0) / completed.length)
    : null

  const visible = sessions.filter(s => {
    if (agentFilter !== 'all' && s.agent !== agentFilter) return false
    if (statusFilter !== 'all' && s.status !== statusFilter) return false
    return true
  })

  function exportCSV() {
    const headers = ['Agent', 'Status', 'Started', 'Duration (s)', 'Attempted', 'Succeeded', 'Failed', 'Rate (%)', 'Tokens', 'Est. Cost (USD)']
    const rows = visible.map(s => [
      agentLabel(s.agent),
      s.status,
      s.started_at ?? '',
      s.duration_seconds ?? '',
      s.products_attempted,
      s.products_succeeded,
      s.products_failed,
      sessionRate(s) ?? '',
      s.total_tokens ?? '',
      s.estimated_cost_usd ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `holloengine-runs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDeleteSession(id: string) {
    await fetch('/api/reports/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    loadSessions()
  }

  function handleRefresh() {
    if (tab === 'runs') { loadSessions() }
    else { setAnalytics(null); loadAnalytics() }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Topbar title="Reports" onRefresh={handleRefresh} refreshing={loading || analyticsLoading} />

      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Tab switcher + Export */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['runs', 'analytics'] as const).map(t => {
            const active = tab === t
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 16px', borderRadius: 6, fontSize: 13,
                  background: active ? 'var(--accent-dim)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  border: `1px solid ${active ? 'var(--accent-glow)' : 'transparent'}`,
                  fontFamily: 'var(--font-body)',
                  textTransform: 'capitalize',
                  transition: 'all 150ms ease',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
        {tab === 'runs' && (
          <button
            onClick={exportCSV}
            style={{
              background: 'transparent', border: '1px solid var(--border-md)',
              color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 14px',
              fontFamily: 'var(--font-body)', fontSize: 13,
              transition: 'all 150ms ease',
            }}
          >
            ↓ Export CSV
          </button>
        )}
        </div>

        {/* ── RUNS TAB ────────────────────────────────────────────────── */}
        {tab === 'runs' && (
          <>
            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              <StatCard label="Total Runs"     value={String(sessions.length)} variant="neutral" />
              <StatCard label="Completed"      value={String(completed.length)} variant="success" />
              <StatCard label="Failed Runs"    value={String(failedSess.length)} variant="neutral" />
              <StatCard label="Products Built" value={String(totalBuilt)} variant="gold" />
            </div>

            {/* Avg success rate strip */}
            {avgRate !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', width: 'fit-content' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Avg Success Rate
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--success)' }}>
                  {avgRate}%
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>across {completed.length} completed runs</span>
              </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Agent</span>
                {['all', 'agent1', 'agent2', 'agent3', 'agent4', 'agent5'].map(a => (
                  <button
                    key={a}
                    onClick={() => setAgentFilter(a)}
                    style={{
                      padding: '5px 11px', borderRadius: 6, fontSize: 12,
                      background: agentFilter === a ? 'var(--accent-dim)' : 'transparent',
                      color: agentFilter === a ? 'var(--accent)' : 'var(--text-muted)',
                      border: '1px solid transparent',
                    }}
                  >
                    {a === 'all' ? 'All' : agentLabel(a)}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Status</span>
                {['all', 'completed', 'failed', 'running'].map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    style={{
                      padding: '5px 11px', borderRadius: 6, fontSize: 12,
                      background: statusFilter === s ? 'var(--accent-dim)' : 'transparent',
                      color: statusFilter === s ? 'var(--accent)' : 'var(--text-muted)',
                      border: '1px solid transparent',
                    }}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Runs table */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ borderBottom: '1px solid var(--border-md)', background: 'var(--surface)' }}>
                  <tr>
                    {['Agent', 'Status', 'Started', 'Duration', 'Attempted', 'Succeeded', 'Failed', 'Rate', ''].map(h => (
                      <th key={h} style={{
                        padding: '10px 14px', textAlign: h === 'Rate' || h === 'Attempted' || h === 'Succeeded' || h === 'Failed' ? 'right' : 'left',
                        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
                  ) : visible.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>No run sessions yet.</td></tr>
                  ) : (
                    visible.map(s => <RunRow key={s.id} s={s} onLogs={setOpenSession} onDelete={handleDeleteSession} />)
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── ANALYTICS TAB ──────────────────────────────────────────── */}
        {tab === 'analytics' && (
          analyticsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
              <div style={{ width: 20, height: 20, border: '2px solid var(--border-md)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : !analytics ? (
            <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--text-muted)', fontSize: 13 }}>Failed to load analytics.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

              {/* Pipeline funnel */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Pipeline Funnel
                  </span>
                </div>
                {(() => {
                  const total = Object.values(analytics.stageCounts).reduce((a, b) => a + b, 0)
                  const maxCount = Math.max(...FUNNEL_STAGES.map(s => analytics.stageCounts[s.status] ?? 0), 1)
                  return FUNNEL_STAGES.map(stage => {
                    const count = analytics.stageCounts[stage.status] ?? 0
                    const pct   = Math.round((count / Math.max(maxCount, 1)) * 100)
                    const totalPct = total > 0 ? Math.round(count / total * 100) : 0
                    return (
                      <div key={stage.status} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ width: 100, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{stage.label}</span>
                        <div style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 600ms ease' }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', width: 30, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', width: 32, textAlign: 'right', flexShrink: 0 }}>{totalPct}%</span>
                      </div>
                    )
                  })
                })()}
              </div>

              {/* Agent processing time */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Agent Processing Time
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10 }}>avg per product · from run history</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Agent', 'Avg / product', 'Min', 'Max', 'Runs'].map((h, i) => (
                        <th key={h} style={{
                          padding: '9px 16px', textAlign: i > 0 ? 'right' : 'left',
                          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(analytics.sessionDurations).map(([label, stat]) => {
                      const isTotal = label === 'Total (all agents)'
                      return (
                        <tr
                          key={label}
                          style={{
                            borderTop: isTotal ? '1px solid var(--border-md)' : undefined,
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: isTotal ? 600 : 400, color: isTotal ? 'var(--gold)' : 'var(--text-primary)' }}>
                            {label}
                          </td>
                          {stat ? (
                            <>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: isTotal ? 'var(--gold)' : 'var(--accent)' }}>
                                {stat.avg}
                              </td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{isTotal ? '—' : stat.min}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{isTotal ? '—' : stat.max}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{isTotal ? '—' : stat.count}</td>
                            </>
                          ) : (
                            <td colSpan={4} style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>No runs yet</td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Products Published */}
              {analytics.throughput.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Products Published — Last 30 Days
                    </span>
                  </div>
                  {(() => {
                    const maxCount = Math.max(...analytics.throughput.map(t => t.count), 1)
                    return analytics.throughput.map(t => (
                      <div key={t.date} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 20px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ width: 64, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{t.date}</span>
                        <div style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${(t.count / maxCount) * 100}%`, height: '100%', background: 'var(--success)', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--success)', width: 24, textAlign: 'right', flexShrink: 0 }}>{t.count}</span>
                      </div>
                    ))
                  })()}
                </div>
              )}

              {/* Failure breakdown */}
              {Object.keys(analytics.failureBreakdown).length > 0 && (
                <div style={{ background: 'var(--error-dim)', border: '1px solid var(--error)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--error)' }}>
                      Failure Breakdown
                    </span>
                  </div>
                  {Object.entries(analytics.failureBreakdown).map(([status, count]) => (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid rgba(239,68,68,0.1)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--error)' }}>{status}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--error)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Stage timing */}
              {analytics.stageTiming.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Stage Timing — avg time between pipeline stages
                    </span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Stage', 'Avg', 'Min', 'Max', 'Samples'].map(h => (
                          <th key={h} style={{ padding: '8px 20px', textAlign: h === 'Stage' ? 'left' : 'right', fontSize: 10, fontWeight: 500, fontFamily: 'var(--font-mono)', letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.stageTiming.map(st => (
                        <tr key={st.stage} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 20px', fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 500 }}>{st.stage}</td>
                          <td style={{ padding: '10px 20px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textAlign: 'right', fontWeight: 600 }}>{st.avg}</td>
                          <td style={{ padding: '10px 20px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textAlign: 'right' }}>{st.min}</td>
                          <td style={{ padding: '10px 20px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textAlign: 'right' }}>{st.max}</td>
                          <td style={{ padding: '10px 20px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textAlign: 'right' }}>{st.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Cloudinary storage */}
              {cloudinary && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Cloudinary Storage
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}>
                    {[
                      { label: 'Storage Used', value: cloudinary.storage_fmt },
                      { label: 'Bandwidth',    value: cloudinary.bandwidth_fmt },
                      { label: 'Images',       value: cloudinary.resources.toLocaleString() },
                    ].map((item, i) => (
                      <div key={item.label} style={{ padding: '16px 20px', borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  {cloudinary.plan && (
                    <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Plan: {cloudinary.plan}
                    </div>
                  )}
                </div>
              )}

              {/* OpenAI API Cost */}
              {analytics.costs && analytics.costs.totalUsd > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      OpenAI API Costs — Estimated
                    </span>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>GPT-4o · $2.50/1M in · $10.00/1M out</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0, borderBottom: '1px solid var(--border)' }}>
                    {[
                      { label: 'Total Spend (all time)', value: `$${analytics.costs.totalUsd.toFixed(4)}` },
                      { label: 'Avg Cost per Product',   value: analytics.costs.avgPerProduct > 0 ? `$${analytics.costs.avgPerProduct.toFixed(5)}` : '—' },
                    ].map((item, i) => (
                      <div key={item.label} style={{ padding: '16px 20px', borderRight: i === 0 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>{item.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Per-agent breakdown */}
                  <div style={{ padding: '12px 20px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    {(['agent2', 'agent3', 'agent4'] as const).map(key => {
                      const a = analytics.costs!.byAgent[key]
                      if (!a || a.totalUsd === 0) return null
                      const share = analytics.costs!.totalUsd > 0 ? (a.totalUsd / analytics.costs!.totalUsd) * 100 : 0
                      const names: Record<string, string> = { agent2: 'Architect', agent3: 'Voice', agent4: 'Optimizer' }
                      return (
                        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {names[key]}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                            ${a.totalUsd.toFixed(4)}
                          </div>
                          <div style={{ width: 80, height: 3, borderRadius: 2, background: 'var(--border-md)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${share}%`, background: 'var(--accent)', borderRadius: 2 }} />
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{share.toFixed(0)}% · {(a.totalTokens / 1000).toFixed(0)}k tokens</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Per-product timeline */}
              {analytics.productTimeline.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Per-Product Timeline — last {analytics.productTimeline.length} completed
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Product', 'Mine→Research', 'Research→Optimize', 'Optimize→Publish', 'Total'].map(h => (
                            <th key={h} style={{ padding: '8px 16px', textAlign: h === 'Product' ? 'left' : 'right', fontSize: 10, fontWeight: 500, fontFamily: 'var(--font-mono)', letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.productTimeline.map(pt => (
                          <tr key={pt.product_id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '9px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {pt.name}
                            </td>
                            {[pt.mine, pt.research, pt.optimize, pt.total].map((val, i) => (
                              <td key={i} style={{ padding: '9px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', color: val ? (i === 3 ? 'var(--accent)' : 'var(--text-secondary)') : 'var(--text-muted)', textAlign: 'right', fontWeight: i === 3 ? 600 : 400 }}>
                                {val ?? '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Session log drawer */}
      {openSession && <SessionLogs session={openSession} onClose={() => setOpenSession(null)} />}
    </div>
  )
}
