'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const AGENTS = [
  { key: 'agent1', label: 'Miner' },
  { key: 'agent2', label: 'Architect' },
  { key: 'agent3', label: 'Voice' },
  { key: 'agent4', label: 'Optimizer' },
  { key: 'agent5', label: 'Publisher' },
]

const POLL_MS = 3000

export default function LogsPanel() {
  const [open,      setOpen]      = useState(false)
  const [agent,     setAgent]     = useState('agent2')
  const [lines,     setLines]     = useState<string[]>([])
  const [mtime,     setMtime]     = useState<number | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/logs?agent=${agent}`)
      const data = await res.json()
      if (data.lines) {
        setLines(data.lines)
        setMtime(data.mtime)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [agent])

  // Fetch on open / agent change
  useEffect(() => {
    if (!open) return
    fetchLogs()
  }, [open, agent, fetchLogs])

  // Auto-poll while panel is open
  useEffect(() => {
    if (!open) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setInterval(fetchLogs, POLL_MS)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [open, fetchLogs])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, autoScroll])

  const lastUpdated = mtime ? new Date(mtime).toLocaleTimeString() : null

  // Colorise log lines
  function lineColor(line: string) {
    if (/error|exception|traceback|failed/i.test(line)) return 'text-red-400'
    if (/warn/i.test(line))                             return 'text-amber-400'
    if (/success|complete|published|done/i.test(line))  return 'text-emerald-400'
    if (/info/i.test(line))                             return 'text-zinc-300'
    return 'text-zinc-500'
  }

  return (
    <div className="bg-[#0d0d1a] border-b border-zinc-800">
      {/* Toggle bar */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-2 text-left
                   hover:bg-zinc-800/30 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-500 group-hover:text-zinc-400">
            Agent Logs
          </span>
          {loading && (
            <span className="w-2.5 h-2.5 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
          )}
          {lastUpdated && !loading && (
            <span className="text-[9px] text-zinc-700">updated {lastUpdated}</span>
          )}
        </div>
        <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-6 pb-4">
          {/* Agent selector */}
          <div className="flex gap-1.5 mb-3">
            {AGENTS.map(a => (
              <button
                key={a.key}
                onClick={() => setAgent(a.key)}
                className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-wide transition-all
                  ${agent === a.key
                    ? 'bg-[#6366f1]/20 border border-[#6366f1]/40 text-[#6366f1]'
                    : 'bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-zinc-300'
                  }`}
              >
                {a.label}
              </button>
            ))}
            <button
              onClick={fetchLogs}
              className="ml-auto px-2.5 py-1 rounded text-[10px] font-bold
                         bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ↻ Refresh
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer ml-1">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="accent-[#6366f1] w-3 h-3"
              />
              <span className="text-[10px] text-zinc-500">Auto-scroll</span>
            </label>
          </div>

          {/* Log output */}
          <div
            className="bg-[#080810] border border-zinc-800 rounded-lg p-3 h-56 overflow-y-auto
                       font-mono text-[10px] leading-relaxed"
            onScroll={e => {
              const el = e.currentTarget
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
              setAutoScroll(atBottom)
            }}
          >
            {lines.length === 0 ? (
              <div className="text-zinc-700 text-center mt-16">No logs yet for this agent.</div>
            ) : (
              lines.map((line, i) => (
                <div key={i} className={lineColor(line)}>{line}</div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  )
}
