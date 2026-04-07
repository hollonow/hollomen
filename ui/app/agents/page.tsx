'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentRun } from '@/context/AgentRunContext'
import Topbar from '@/components/Topbar'
import type { RunSession } from '@/types'

// ── Agent metadata ─────────────────────────────────────────────────────────────
const AGENTS = [
  {
    key:           'agent1',
    label:         'Miner',
    num:           1,
    description:   'Scrapes Yupoo albums, downloads images to Cloudinary, stages rows for research.',
    triggerStatus: 'READY_FOR_SCRAPE',
    borderColor:   'var(--accent)',
  },
  {
    key:           'agent2',
    label:         'Architect',
    num:           2,
    description:   'Reverse-engineers the product via Google Lens + GPT-4o. Identifies brand, type, and name.',
    triggerStatus: 'READY_FOR_RESEARCH',
    borderColor:   '#7B9CF6',
  },
  {
    key:           'agent3',
    label:         'Voice',
    num:           3,
    description:   'Generates SEO titles, meta descriptions, 150-word narratives, FAQs, and JSON-LD schemas.',
    triggerStatus: 'READY_FOR_SEO',
    borderColor:   '#4CAF8C',
  },
  {
    key:           'agent4',
    label:         'Optimizer',
    num:           4,
    description:   'Classifies viewpoints, converts to WebP, renames files with SEO slugs, updates Cloudinary.',
    triggerStatus: 'READY_FOR_PUBLISH',
    borderColor:   'var(--gold)',
  },
  {
    key:           'agent5',
    label:         'Publisher',
    num:           5,
    description:   'Uploads images to WordPress Media Library, creates WooCommerce draft with SEO + variations.',
    triggerStatus: 'PUBLISHED',
    borderColor:   '#C96CF6',
  },
]

const PIPELINE_STEPS = [
  { agent: 'agent1', label: 'Miner',     triggerStatus: 'READY_FOR_SCRAPE'   },
  { agent: 'agent2', label: 'Architect', triggerStatus: 'READY_FOR_RESEARCH' },
  { agent: 'agent3', label: 'Voice',     triggerStatus: 'READY_FOR_SEO'      },
  { agent: 'agent4', label: 'Optimizer', triggerStatus: 'READY_FOR_PUBLISH'  },
  { agent: 'agent5', label: 'Publisher', triggerStatus: 'PUBLISHED'          },
]

const POLL_MS     = 10_000
const TIMEOUT_MS  = 30 * 60_000
const LOG_POLL_MS = 3_000

interface QueueStats {
  queues: Record<string, number>
  needsReview: number
  failed: number
  live: number
  pendingApproval: number
  total: number
}

function logLineColor(line: string): string {
  if (/\[ERROR\]|\[CRITICAL\]/i.test(line)) return 'var(--error)'
  if (/\[WARNING\]/i.test(line))             return 'var(--warning)'
  if (/batch.*complete|publish.*complete|success/i.test(line)) return 'var(--success)'
  return 'var(--text-secondary)'
}

function formatMs(ms: number): string {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function AutomationPage() {
  const { runningAgent, setRunningAgent } = useAgentRun()
  const [pipelineStep, setPipelineStep]   = useState<string | null>(null)
  const [toast, setToast]                 = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [stats, setStats]                 = useState<QueueStats | null>(null)
  const [sessions, setSessions]           = useState<RunSession[]>([])
  const [logAgent, setLogAgent]           = useState('agent1')
  const [logLines, setLogLines]           = useState<string[]>([])
  const [logLoading, setLogLoading]       = useState(false)
  const logBottomRef = useRef<HTMLDivElement>(null)
  const toastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopPipelineRef = useRef(false)

  function showToast(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type })
    if (toastTimer.current != null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/stats')
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/reports/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions ?? [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchStats(); fetchSessions() }, [fetchStats, fetchSessions])
  useEffect(() => {
    const id = setInterval(fetchStats, 15_000)
    return () => clearInterval(id)
  }, [fetchStats])

  const fetchLogs = useCallback(async () => {
    setLogLoading(true)
    try {
      const res = await fetch(`/api/logs?agent=${logAgent}`)
      const data = await res.json()
      if (data.lines) setLogLines(data.lines)
    } catch { /* ignore */ }
    finally { setLogLoading(false) }
  }, [logAgent])

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => {
    const id = setInterval(fetchLogs, LOG_POLL_MS)
    return () => clearInterval(id)
  }, [fetchLogs])

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines])

  async function runAgent(key: string, label: string) {
    setRunningAgent(key)
    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: key }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      showToast(`${label} started`, 'ok')
      setLogAgent(key)
    } catch (e) {
      showToast(`Failed to start ${label}: ${e}`, 'err')
    } finally {
      setRunningAgent(null)
      fetchStats()
    }
  }

  async function runFullPipeline() {
    stopPipelineRef.current = false
    setRunningAgent('pipeline')
    try {
      for (const step of PIPELINE_STEPS) {
        if (stopPipelineRef.current) break
        const check = await fetch('/api/data').then(r => r.json())
        const pending = (check.products ?? []).filter(
          (p: { status: string }) => p.status === step.triggerStatus
        )
        if (pending.length === 0) continue
        setPipelineStep(`${step.label}: starting (${pending.length} products)…`)
        const res = await fetch('/api/run-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: step.agent }),
        })
        const data = await res.json()
        if (!res.ok || data.error) throw new Error(data.error || `Failed to start ${step.label}`)
        const deadline = Date.now() + TIMEOUT_MS
        while (Date.now() < deadline && !stopPipelineRef.current) {
          await new Promise(r => setTimeout(r, POLL_MS))
          const poll = await fetch('/api/data').then(r => r.json())
          const remaining = (poll.products ?? []).filter(
            (p: { status: string }) => p.status === step.triggerStatus
          )
          if (remaining.length === 0) break
          setPipelineStep(`${step.label}: ${remaining.length} remaining…`)
        }
      }
      showToast('Full pipeline complete', 'ok')
    } catch (e) {
      showToast(`Pipeline error: ${e}`, 'err')
    } finally {
      setRunningAgent(null)
      setPipelineStep(null)
      fetchStats()
      fetchSessions()
    }
  }

  // Last run sub-line per agent from sessions
  function lastRunInfo(agentKey: string): string | null {
    const completed = sessions
      .filter(s => s.agent === agentKey && s.status === 'completed' && s.duration_seconds != null && s.products_attempted > 0)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    if (completed.length === 0) return null
    const s = completed[0]
    const ms = Math.round((s.duration_seconds! / Math.max(s.products_succeeded, 1)) * 1000)
    const rate = Math.round(s.products_succeeded / Math.max(s.products_attempted, 1) * 100)
    return `${formatMs(ms)}/product · ${s.products_succeeded}/${s.products_attempted} (${rate}%)`
  }

  const busy = runningAgent !== null

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Topbar
        title="Automation"
        rightSlot={
          <button
            onClick={runFullPipeline}
            disabled={busy}
            style={{
              background: busy ? 'var(--surface-2)' : 'var(--accent)',
              border: `1px solid ${busy ? 'var(--border-md)' : 'var(--accent)'}`,
              color: busy ? 'var(--text-muted)' : '#fff',
              borderRadius: 8, padding: '8px 18px',
              fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 500,
              transition: 'all 150ms ease',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {runningAgent === 'pipeline'
              ? <><span style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />{pipelineStep ?? 'Running…'}</>
              : '▶ Run Full Pipeline'
            }
          </button>
        }
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Agent cards — 5 columns */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          {AGENTS.map(agent => {
            const queueCount = stats?.queues[agent.key] ?? 0
            const isRunning  = runningAgent === agent.key
            const lastRun    = lastRunInfo(agent.key)
            const lastRunSessions = sessions.filter(s => s.agent === agent.key && s.status === 'completed' && s.products_attempted > 0)
            const lastRate   = lastRunSessions.length > 0
              ? Math.round(lastRunSessions[0].products_succeeded / Math.max(lastRunSessions[0].products_attempted, 1) * 100)
              : null

            return (
              <div
                key={agent.key}
                style={{
                  background: isRunning ? 'var(--accent-dim)' : 'var(--surface)',
                  border: `1px solid ${isRunning ? 'var(--accent-glow)' : 'var(--border)'}`,
                  borderRadius: 12, padding: 20,
                  display: 'flex', flexDirection: 'column', gap: 12,
                  transition: 'all 200ms ease',
                }}
              >
                {/* Header */}
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
                    Agent {agent.num}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                    {agent.label}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {agent.description}
                  </div>
                </div>

                {/* Queue badge */}
                <div style={{
                  background: queueCount > 0 ? 'var(--accent-dim)' : 'var(--surface-2)',
                  color: queueCount > 0 ? 'var(--accent)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  padding: '4px 10px', borderRadius: 6, display: 'inline-block',
                }}>
                  {queueCount > 0 ? `${queueCount} queued` : 'Queue empty'}
                </div>

                {/* Last run sub-line */}
                {lastRun && (
                  <div style={{
                    fontSize: 11.5, fontFamily: 'var(--font-mono)',
                    color: lastRate != null && lastRate < 50 ? 'var(--warning)' : 'var(--text-muted)',
                  }}>
                    {lastRun}
                  </div>
                )}

                {/* Run button */}
                <button
                  disabled={busy}
                  onClick={() => runAgent(agent.key, agent.label)}
                  style={{
                    marginTop: 'auto',
                    width: '100%', borderRadius: 8, padding: '8px 14px',
                    background: 'transparent',
                    border: `1px solid ${agent.borderColor}`,
                    color: agent.borderColor,
                    fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 500,
                    opacity: busy ? 0.4 : 1,
                    transition: 'all 150ms ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {isRunning
                    ? <><span style={{ width: 12, height: 12, border: `2px solid ${agent.borderColor}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />Running…</>
                    : `▶ Run ${agent.label}`
                  }
                </button>
              </div>
            )
          })}
        </div>

        {/* Summary strip */}
        {stats && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {stats.total} Total
            </div>
            {stats.needsReview > 0 && (
              <div style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--warning)', background: 'var(--warning-dim)', fontSize: 12.5, color: 'var(--warning)' }}>
                {stats.needsReview} Needs Review
              </div>
            )}
            {stats.pendingApproval > 0 && (
              <div style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--accent-glow)', background: 'var(--accent-dim)', fontSize: 12.5, color: 'var(--accent)' }}>
                {stats.pendingApproval} Pending Approval
              </div>
            )}
            {stats.failed > 0 && (
              <div style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--error)', background: 'var(--error-dim)', fontSize: 12.5, color: 'var(--error)' }}>
                {stats.failed} Failed
              </div>
            )}
          </div>
        )}

        {/* Live logs */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Live Logs
            </span>
            {logLoading && (
              <span style={{ width: 10, height: 10, border: '2px solid var(--text-muted)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {AGENTS.map(a => {
                const active = logAgent === a.key
                return (
                  <button
                    key={a.key}
                    onClick={() => setLogAgent(a.key)}
                    style={{
                      fontSize: 12, fontFamily: 'var(--font-mono)', padding: '5px 12px', borderRadius: 6,
                      background: active ? 'var(--accent-dim)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                      border: `1px solid ${active ? 'var(--accent-glow)' : 'var(--border)'}`,
                      transition: 'all 150ms ease',
                    }}
                  >
                    {a.label}
                  </button>
                )
              })}
              <button
                onClick={fetchLogs}
                style={{ fontSize: 12, fontFamily: 'var(--font-mono)', padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'transparent' }}
              >
                ↻
              </button>
            </div>
          </div>

          {/* Log terminal */}
          <div style={{
            background: 'var(--bg)', borderRadius: '0 0 10px 10px',
            padding: 16, maxHeight: 280, overflowY: 'auto',
            fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
          }}>
            {logLines.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>No logs yet for this agent.</div>
            ) : (
              logLines.map((line, i) => (
                <div key={i} style={{ color: logLineColor(line) }}>{line}</div>
              ))
            )}
            <div ref={logBottomRef} />
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 100,
          background: 'var(--surface)', border: `1px solid ${toast.type === 'ok' ? 'var(--success)' : 'var(--error)'}`,
          color: toast.type === 'ok' ? 'var(--success)' : 'var(--error)',
          borderRadius: 8, padding: '10px 16px', fontSize: 12.5, fontWeight: 500,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
