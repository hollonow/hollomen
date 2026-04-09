'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentRun } from '@/context/AgentRunContext'

const AGENTS = [
  { key: 'agent1', label: 'Agent 1', role: 'Miner',     logKey: 'agent1', color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  { key: 'agent2', label: 'Agent 2', role: 'Architect', logKey: 'agent2', color: 'text-violet-400  bg-violet-500/10  border-violet-500/30'  },
  { key: 'agent3', label: 'Agent 3', role: 'Voice',     logKey: 'agent3', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  { key: 'agent4', label: 'Agent 4', role: 'Optimizer', logKey: 'agent4', color: 'text-amber-400   bg-amber-500/10   border-amber-500/30'   },
  { key: 'agent5', label: 'Agent 5', role: 'Publisher', logKey: 'agent5', color: 'text-pink-400    bg-pink-500/10    border-pink-500/30'    },
]

const PIPELINE_STEPS = [
  { agent: 'agent1', label: 'Miner',     triggerStatus: 'READY_FOR_SCRAPE',   claimingStatus: 'SCRAPING'    },
  { agent: 'agent2', label: 'Architect', triggerStatus: 'READY_FOR_RESEARCH', claimingStatus: 'RESEARCHING' },
  { agent: 'agent3', label: 'Voice',     triggerStatus: 'READY_FOR_SEO',      claimingStatus: 'WRITING_SEO' },
  { agent: 'agent4', label: 'Optimizer', triggerStatus: 'READY_FOR_PUBLISH',  claimingStatus: 'OPTIMIZING'  },
  { agent: 'agent5', label: 'Publisher', triggerStatus: 'PUBLISHED',          claimingStatus: 'PUBLISHING'  },
]

// Statuses that are terminal (pipeline is "done" when all products are in one of these)
const TERMINAL_STATUSES = new Set([
  'PENDING_APPROVAL', 'SCRAPPED', 'DUPLICATE', 'DISCOVERED', 'NEEDS_REVIEW',
  'RESEARCH_FAILED', 'SEO_FAILED', 'OPTIMIZE_FAILED', 'PUBLISH_FAILED', 'SCRAPE_FAILED',
])

const POLL_MS    = 3_000
const TIMEOUT_MS = 30 * 60_000

// Only match definitive end-of-run log markers, not per-item progress lines
const DONE_PATTERNS = /BATCH PROCESSING COMPLETE|PUBLISH COMPLETE|CALIBRATION COMPLETE|No \w+ rows found|nothing to process|Traceback \(most recent/i

interface ActiveAgent {
  key: string
  label: string
  role: string
  color: string
  startedAt: number
}

interface Props {
  onToast: (msg: string, type: 'ok' | 'err') => void
  pendingCounts?: Record<string, number>
  onNotify?: (msg: string, type: 'success' | 'error') => void
}

// Parse log line timestamp; return ms since epoch or null if unparseable
function parseLogTimestamp(line: string): number | null {
  const m = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+(Z?)\]/)
  if (!m) return null
  // Supabase-sourced lines have 'Z' suffix (UTC); local log file lines do not (local time).
  return new Date(m[1].replace(' ', 'T') + m[2]).getTime()
}

// Extract batch result from current-run log lines: "done · 3 ok" or "done · 2 ok, 1 failed"
function parseBatchResult(lines: string[]): string {
  // Agents 1-4: "  ✅ Successful (STATUS): N"
  const successLine = lines.find(l => /Successful[^:]*:\s*\d+/.test(l))
  const ok = successLine ? parseInt(successLine.match(/Successful[^:]*:\s*(\d+)/i)![1]) : null

  // Agent 5 publisher: "Published:    N"
  const publishLine = lines.find(l => /Published:\s+\d+/.test(l))
  const okPub = publishLine ? parseInt(publishLine.match(/Published:\s+(\d+)/i)![1]) : null

  const totalOk = ok ?? okPub

  // Failed: "  ❌ Failed (FAILURE_STATUS): N" or "Failed:       N"
  const failLine = lines.find(l => /Failed[^:]*:\s*\d+/.test(l) && !/Rate limiting/.test(l))
  const fail = failLine ? parseInt(failLine.match(/Failed[^:]*:\s*(\d+)/i)![1]) : null

  if (totalOk === null) return 'done'
  if (fail && fail > 0) return `done · ${totalOk} ok, ${fail} failed`
  return `done · ${totalOk} ok`
}

export default function AgentControls({ onToast, pendingCounts, onNotify }: Props) {
  const { runningAgent, setRunningAgent } = useAgentRun()
  const [pipelineStep, setPipelineStep]  = useState<string | null>(null)
  const [loopPipeline, setLoopPipeline]  = useState(false)
  const [pipelineCycle, setPipelineCycle] = useState(0)

  const [activeAgent, setActiveAgent]    = useState<ActiveAgent | null>(null)
  const activeAgentRef = useRef<ActiveAgent | null>(null)  // ref so pollLog can read without re-creating
  const [lastLogLine, setLastLogLine]    = useState<string>('')
  const [agentDone, setAgentDone]        = useState(false)
  const [doneLabel, setDoneLabel]        = useState<string>('done')
  const [stopRequested, setStopRequested]         = useState(false)
  const [errorSummary, setErrorSummary]  = useState<string | null>(null)
  const [interpretLoading, setInterpretLoading] = useState(false)
  const stopPipelineRef = useRef(false)            // ref avoids stale closure in pipeline loop
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep ref in sync with state
  useEffect(() => { activeAgentRef.current = activeAgent }, [activeAgent])

  // Poll the log file for the active agent
  const pollLog = useCallback(async (agentKey: string) => {
    try {
      const res  = await fetch(`/api/logs?agent=${agentKey}`)
      const data = await res.json()
      const lines: string[] = data.lines ?? []

      // Filter to lines from the current run only (by timestamp)
      const startedAt = activeAgentRef.current?.startedAt ?? 0
      const currentRunLines = lines.filter(line => {
        const ts = parseLogTimestamp(line)
        if (ts === null) return true  // include unparseable lines as safety net
        return ts >= startedAt
      })

      // Last meaningful line from current run
      const meaningful = [...currentRunLines].reverse().find(l => l.trim().length > 10) ?? ''
      if (meaningful) setLastLogLine(meaningful.trim())

      // Done detection — current run only
      if (currentRunLines.some(l => DONE_PATTERNS.test(l))) {
        setDoneLabel(parseBatchResult(currentRunLines))
        setAgentDone(true)
      }
    } catch { /* ignore poll errors */ }
  }, [])

  // Start / stop log polling when activeAgent changes
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (!activeAgent) return

    setAgentDone(false)
    setDoneLabel('done')
    setLastLogLine('')
    setStopRequested(false)
    setErrorSummary(null)

    pollLog(activeAgent.key)
    pollRef.current = setInterval(() => pollLog(activeAgent.key), POLL_MS)

    const timeout = setTimeout(() => {
      setActiveAgent(null)
      setLastLogLine('')
    }, TIMEOUT_MS)

    return () => {
      clearInterval(pollRef.current!)
      clearTimeout(timeout)
    }
  }, [activeAgent, pollLog])

  // Fire completion notification when done
  useEffect(() => {
    if (!agentDone || !activeAgent) return
    setStopRequested(false)
    stopPipelineRef.current = false
    const isError = /\[ERROR\]|\[CRITICAL\]/i.test(lastLogLine)
    onNotify?.(
      isError
        ? `${activeAgent.label} (${activeAgent.role}) encountered an error — check logs.`
        : `${activeAgent.label} (${activeAgent.role}) finished.`,
      isError ? 'error' : 'success'
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentDone])

  // Auto-interpret errors when a run finishes with failures
  useEffect(() => {
    if (!agentDone || !activeAgent) return
    const hasFailed = /failed/i.test(doneLabel) || /\[ERROR\]|\[CRITICAL\]/i.test(lastLogLine)
    if (!hasFailed) return

    setInterpretLoading(true)
    fetch('/api/interpret-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: activeAgent.key, startedAt: activeAgent.startedAt }),
    })
      .then(r => r.json())
      .then(d => { if (d.summary) setErrorSummary(d.summary) })
      .catch(() => {/* silent — interpretation is non-critical */})
      .finally(() => setInterpretLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentDone])

  async function handleStop() {
    if (!activeAgent) return
    setStopRequested(true)
    setLastLogLine('Stop requested — finishing current item…')
    // Write stop flag for the Python process
    await fetch('/api/stop-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: activeAgent.key }),
    })
    // If pipeline is running, also stop it from advancing to the next step
    if (runningAgent === 'pipeline') {
      stopPipelineRef.current = true
      await fetch('/api/stop-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'pipeline' }),
      })
    }
  }

  async function runAgent(a: typeof AGENTS[0]) {
    setRunningAgent(a.key)
    setActiveAgent({ key: a.key, label: a.label, role: a.role, color: a.color, startedAt: Date.now() })
    setAgentDone(false)
    setLastLogLine('Starting…')
    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: a.key }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      onToast(`${a.label} started — watching logs…`, 'ok')
    } catch (e) {
      onToast(`Failed to start ${a.label}: ${e}`, 'err')
      setActiveAgent(null)
    } finally {
      setRunningAgent(null)
    }
  }

  async function runFullPipeline() {
    stopPipelineRef.current = false
    setRunningAgent('pipeline')
    setPipelineCycle(0)
    let cycle = 0

    try {
      do {
        cycle++
        setPipelineCycle(cycle)

        for (const step of PIPELINE_STEPS) {
          if (stopPipelineRef.current) break

          const check   = await fetch('/api/data', { cache: 'no-store' }).then(r => r.json())
          const pending = (check.products ?? []).filter(
            (p: { status: string }) => p.status === step.triggerStatus
          )
          if (pending.length === 0) continue

          const meta = AGENTS.find(a => a.key === step.agent)!
          setActiveAgent({ ...meta, startedAt: Date.now() })
          setAgentDone(false)
          setLastLogLine('Starting…')
          setPipelineStep(`Cycle ${cycle} · ${step.label}: starting (${pending.length} products)…`)

          const res = await fetch('/api/run-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent: step.agent }),
          })
          const data = await res.json()
          if (!res.ok || data.error) throw new Error(data.error || `Failed to start ${step.label}`)

          // Wait until BOTH the trigger queue AND the claiming queue drain to zero.
          // Without checking claimingStatus, the pipeline would advance prematurely
          // as soon as rows are claimed (READY_FOR_PUBLISH → OPTIMIZING) before they finish.
          const deadline = Date.now() + TIMEOUT_MS
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, POLL_MS))
            if (stopPipelineRef.current) break
            const poll = await fetch('/api/data', { cache: 'no-store' }).then(r => r.json())
            const remaining = (poll.products ?? []).filter(
              (p: { status: string }) =>
                p.status === step.triggerStatus || p.status === step.claimingStatus
            )
            if (remaining.length === 0) {
              // Confirm drain is stable: wait one more interval and re-check.
              // Guards against a transient zero count between sequential claim operations.
              await new Promise(r => setTimeout(r, POLL_MS))
              const confirm = await fetch('/api/data', { cache: 'no-store' }).then(r => r.json())
              const stillRemaining = (confirm.products ?? []).filter(
                (p: { status: string }) =>
                  p.status === step.triggerStatus || p.status === step.claimingStatus
              )
              if (stillRemaining.length === 0) break
              // Not stable yet — continue polling
              setPipelineStep(`Cycle ${cycle} · ${step.label}: ${stillRemaining.length} remaining…`)
              continue
            }
            setPipelineStep(`Cycle ${cycle} · ${step.label}: ${remaining.length} remaining…`)
          }

          if (stopPipelineRef.current) break
        }

        if (stopPipelineRef.current) break

        // Loop mode: check if any pipeline queue still has work to do
        if (loopPipeline) {
          const check2 = await fetch('/api/data', { cache: 'no-store' }).then(r => r.json())
          const allProducts: { status: string }[] = check2.products ?? []
          const queuedCount = allProducts.filter(p => !TERMINAL_STATUSES.has(p.status)).length
          if (queuedCount === 0) break  // all done — exit loop
          // else continue next cycle
        }

      } while (loopPipeline && !stopPipelineRef.current)

      if (stopPipelineRef.current) {
        onToast('Pipeline stopped after current step.', 'ok')
      } else {
        onToast(loopPipeline && cycle > 1
          ? `Full pipeline complete — ${cycle} cycles processed.`
          : 'Full pipeline complete.',
        'ok')
      }
    } catch (e) {
      onToast(`Pipeline error: ${e}`, 'err')
    } finally {
      setRunningAgent(null)
      setPipelineStep(null)
      setPipelineCycle(0)
      stopPipelineRef.current = false
    }
  }

  const busy = runningAgent !== null

  // Derive live log line color — use log level prefix, not word matching
  function logLineColor(line: string) {
    if (/\[ERROR\]|\[CRITICAL\]|Traceback/i.test(line)) return 'text-red-400'
    if (/\[WARNING\]/i.test(line))                       return 'text-amber-400'
    if (/BATCH PROCESSING COMPLETE|PUBLISH COMPLETE/i.test(line)) return 'text-emerald-400'
    return 'text-zinc-400'
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Button row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Full pipeline button + loop toggle */}
        <div className="flex items-center gap-1">
          <button
            disabled={busy}
            onClick={runFullPipeline}
            className="px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                       transition-all disabled:opacity-40
                       text-indigo-300 bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/20"
          >
            {runningAgent === 'pipeline' ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                {pipelineCycle > 1 ? `Cycle ${pipelineCycle} · ` : ''}{pipelineStep ?? 'Running…'}
              </span>
            ) : '⚡ Full Pipeline'}
          </button>
          {/* Loop toggle — keep running cycles of 20 until all queues drain */}
          <button
            disabled={busy}
            onClick={() => setLoopPipeline(p => !p)}
            title={loopPipeline ? 'Loop mode ON — will repeat until all queues are empty' : 'Loop mode OFF — runs one cycle of 20 then stops'}
            className={`px-2 py-1.5 rounded-lg border text-[10px] font-bold tracking-wide
                        transition-all disabled:opacity-40
                        ${loopPipeline
                          ? 'text-indigo-300 bg-indigo-500/20 border-indigo-500/50'
                          : 'text-zinc-600 bg-zinc-800/60 border-zinc-700 hover:text-zinc-400'
                        }`}
          >
            ↻
          </button>
        </div>

        <span className="text-zinc-700 text-[10px]">|</span>

        {/* Agent 0 — Calibration (prerequisite, not part of pipeline loop) */}
        <button
          disabled={busy}
          onClick={async () => {
            setRunningAgent('agent0')
            setActiveAgent({ key: 'agent0', label: 'Agent 0', role: 'Calibrator', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', startedAt: Date.now() })
            setAgentDone(false)
            setLastLogLine('Starting…')
            try {
              const res = await fetch('/api/run-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent: 'agent0' }),
              })
              const data = await res.json()
              if (!res.ok || data.error) throw new Error(data.error || 'Failed')
              onToast('Calibration started — watching logs…', 'ok')
            } catch (e) {
              onToast(`Failed to start calibrator: ${e}`, 'err')
              setActiveAgent(null)
            } finally {
              setRunningAgent(null)
            }
          }}
          title="Re-scrape client sites and rebuild attribute_matrix.json (brand voice calibration)"
          className="px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                     transition-all disabled:opacity-40
                     text-purple-400 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20"
        >
          {runningAgent === 'agent0' ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
              Calibrating…
            </span>
          ) : '⚙ Calibrate'}
        </button>

        <span className="text-zinc-700 text-[10px]">|</span>

        {/* Individual agent buttons */}
        {AGENTS.map(a => {
          const pending  = pendingCounts?.[a.key] ?? 0
          const isActive = activeAgent?.key === a.key && !agentDone
          return (
            <button
              key={a.key}
              disabled={busy}
              onClick={() => runAgent(a)}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                          transition-all disabled:opacity-40
                          ${isActive ? 'ring-1 ring-inset ring-indigo-500/50 animate-pulse' : ''}
                          ${a.color}`}
            >
              {runningAgent === a.key ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                  Starting…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  {`▶ ${a.label} · ${a.role}`}
                  {pending > 0 && (
                    <span className="rounded px-1 py-0.5 text-[9px] font-bold leading-none bg-current/20">
                      {pending}
                    </span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Live status strip + error callout — shows while an agent is active */}
      {activeAgent && (
        <>
        <div className={`
          rounded-lg border px-3 py-2 flex items-start gap-2.5 text-[11px]
          ${agentDone
            ? 'bg-zinc-900 border-zinc-700'
            : 'bg-zinc-900/80 border-zinc-700'
          }
        `}>
          {/* Status dot */}
          <div className="flex-shrink-0 mt-0.5">
            {agentDone ? (
              <div className={`w-2 h-2 rounded-full ${/\[ERROR\]|\[CRITICAL\]/i.test(lastLogLine) ? 'bg-red-500' : 'bg-emerald-500'}`} />
            ) : stopRequested ? (
              <div className="w-2 h-2 rounded-full bg-amber-500" />
            ) : (
              <div className="relative w-2 h-2">
                <div className="absolute inset-0 rounded-full bg-[#6366f1] animate-ping opacity-60" />
                <div className="absolute inset-0 rounded-full bg-[#6366f1]" />
              </div>
            )}
          </div>

          {/* Label + log line */}
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-zinc-300">
                {activeAgent.label} · {activeAgent.role}
              </span>
              <span className={`text-[9px] font-bold tracking-widest uppercase ${
                agentDone
                  ? /failed/i.test(doneLabel) ? 'text-red-500' : 'text-zinc-500'
                  : stopRequested ? 'text-amber-500' : 'text-[#6366f1]'
              }`}>
                {agentDone ? doneLabel : stopRequested ? 'stopping…' : 'running'}
              </span>
            </div>
            {lastLogLine && (
              <span className={`text-[10px] font-mono truncate ${logLineColor(lastLogLine)}`}>
                {lastLogLine}
              </span>
            )}
          </div>

          {/* Stop button (running) / Dismiss (done) */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {!agentDone && !stopRequested && (
              <button
                onClick={handleStop}
                className="text-[10px] font-bold text-zinc-500 hover:text-red-400 transition-colors
                           border border-zinc-700 hover:border-red-500/40 rounded px-2 py-0.5"
              >
                ⏹ Stop
              </button>
            )}
            <button
              onClick={() => { setActiveAgent(null); setLastLogLine(''); setErrorSummary(null) }}
              className="text-zinc-700 hover:text-zinc-400 text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        {/* AI error interpretation callout */}
        {(interpretLoading || errorSummary) && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex items-start gap-2">
            <span className="text-amber-400 text-[11px] flex-shrink-0 mt-px">⚠</span>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              {interpretLoading
                ? <span className="text-zinc-500 italic">Interpreting errors…</span>
                : errorSummary
              }
            </p>
            {errorSummary && !interpretLoading && (
              <button
                onClick={() => setErrorSummary(null)}
                className="ml-auto text-zinc-600 hover:text-zinc-400 text-xs flex-shrink-0"
              >
                ✕
              </button>
            )}
          </div>
        )}
        </>
      )}
    </div>
  )
}
