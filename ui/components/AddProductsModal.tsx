'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAddProducts } from '@/context/AddProductsContext'

const AGENTS = ['Miner', 'Architect', 'Voice', 'Optimizer', 'Publisher']

export default function AddProductsModal() {
  const { isOpen, close } = useAddProducts()

  const [url, setUrl]           = useState('')
  const [isBulk, setIsBulk]     = useState(false)
  const [runMode, setRunMode]    = useState<'full' | 'select'>('full')
  const [agents, setAgents]      = useState<Set<string>>(new Set(AGENTS))
  const [submitting, setSubmitting] = useState(false)
  const [visible, setVisible]    = useState(false)

  // Animate in
  useEffect(() => {
    if (isOpen) {
      const t = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(t)
    } else {
      setVisible(false)
    }
  }, [isOpen])

  // Escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }, [close])

  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, handleEscape])

  function toggleAgent(name: string) {
    setAgents(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function handleSubmit() {
    const trimmed = url.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const urls = isBulk
        ? trimmed.split('\n').map(u => u.trim()).filter(Boolean)
        : [trimmed]
      const body = urls.length === 1 ? { url: urls[0] } : { urls }
      const res = await fetch('/api/add-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setUrl('')
        close()
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  const contextNote = runMode === 'full'
    ? 'Runs all 5 agents in sequence: Miner → Architect → Voice → Optimizer → Publisher'
    : `Runs selected agents only: ${Array.from(agents).join(', ') || 'none selected'}`

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(4,4,10,0.82)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 580, maxWidth: 'calc(100vw - 40px)',
          background: 'var(--surface-3)',
          border: '1px solid var(--border-bright)',
          borderRadius: 16,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 250ms ease, transform 250ms ease',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 26px 18px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Add Products to Pipeline
          </h2>
          <button
            onClick={close}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--surface-2)', border: '1px solid var(--border-md)',
              color: 'var(--text-secondary)', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '0 26px 6px' }}>

          {/* URL input row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
              Yupoo URL{isBulk ? 's' : ''}
            </label>
            {/* Bulk toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bulk mode</span>
              <button
                onClick={() => setIsBulk(b => !b)}
                style={{
                  position: 'relative',
                  width: 38, height: 21,
                  borderRadius: 11,
                  background: isBulk ? 'var(--accent)' : 'var(--surface-2)',
                  border: `1px solid ${isBulk ? 'var(--accent)' : 'var(--border-md)'}`,
                  transition: 'background 200ms ease, border-color 200ms ease',
                  padding: 0,
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: 2, left: isBulk ? 19 : 2,
                  width: 15, height: 15,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 200ms ease',
                }} />
              </button>
            </div>
          </div>

          <textarea
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder={isBulk
              ? 'Paste one Yupoo URL per line…'
              : 'https://yupoo.com/photos/…'}
            style={{
              width: '100%',
              background: 'var(--surface-2)', border: '1px solid var(--border-md)',
              borderRadius: 9, padding: '12px 14px',
              minHeight: isBulk ? 140 : 72,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)', fontSize: 13.5,
              resize: 'vertical',
              boxSizing: 'border-box',
              transition: 'min-height 200ms ease',
            }}
          />

          {/* Run Mode */}
          <div style={{ marginTop: 16, marginBottom: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>
              Run Mode
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(['full', 'select'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setRunMode(mode)}
                  style={{
                    background: runMode === mode ? 'var(--accent-dim)' : 'var(--bg)',
                    border: `1px solid ${runMode === mode ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 9, padding: '13px 14px',
                    color: runMode === mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                    textAlign: 'left',
                    fontFamily: 'var(--font-body)', fontSize: 13.5,
                    transition: 'all 150ms ease',
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 3 }}>
                    {mode === 'full' ? 'Full Pipeline' : 'Select Agents'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {mode === 'full' ? 'All 5 agents in sequence' : 'Choose which agents to run'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Agent pills — visible only when "Select Agents" */}
          {runMode === 'select' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {AGENTS.map(name => {
                const on = agents.has(name)
                return (
                  <button
                    key={name}
                    onClick={() => toggleAgent(name)}
                    style={{
                      borderRadius: 20, padding: '6px 13px', fontSize: 12,
                      fontFamily: 'var(--font-body)', fontWeight: 500,
                      background: on ? 'var(--accent-dim)' : 'transparent',
                      border: `1px solid ${on ? 'var(--accent-glow)' : 'var(--border-md)'}`,
                      color: on ? 'var(--accent)' : 'var(--text-secondary)',
                      transition: 'all 150ms ease',
                    }}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '18px 26px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16,
        }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, flex: 1 }}>
            {contextNote}
          </p>
          <button
            onClick={handleSubmit}
            disabled={submitting || !url.trim()}
            style={{
              background: 'var(--accent)', border: '1px solid var(--accent)',
              color: '#fff', borderRadius: 8, padding: '9px 22px',
              fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 500,
              opacity: submitting || !url.trim() ? 0.5 : 1,
              transition: 'opacity 150ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            {submitting ? 'Adding…' : 'Run Pipeline →'}
          </button>
        </div>
      </div>
    </div>
  )
}
