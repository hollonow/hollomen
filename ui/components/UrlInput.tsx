'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useRef, useCallback, useEffect } from 'react'

interface UrlInputProps {
  onSubmit: (url: string, isBulk: boolean) => Promise<void>
  disabled?: boolean
}

type InputState = 'idle' | 'loading' | 'success' | 'error'

export default function UrlInput({ onSubmit, disabled }: UrlInputProps) {
  const [url, setUrl] = useState('')
  const [bulk, setBulk] = useState(false)
  const [state, setState] = useState<InputState>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed || state === 'loading' || disabled) return

    setState('loading')
    try {
      await onSubmit(trimmed, bulk)
      setState('success')
      setUrl('')
    } catch {
      setState('error')
    }

    resetTimer.current = setTimeout(() => setState('idle'), 2000)
  }, [url, bulk, state, disabled, onSubmit])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !bulk) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const buttonConfig: Record<InputState, { bg: string; text: string; label: string }> = {
    idle: {
      bg: 'bg-[#6366f1]/20 border border-[#6366f1]/40',
      text: 'text-[#6366f1]',
      label: 'Add \u2192',
    },
    loading: {
      bg: 'bg-zinc-800 border border-zinc-700',
      text: 'text-zinc-500',
      label: '\u27F3',
    },
    success: {
      bg: 'bg-emerald-500/20 border border-emerald-500/30',
      text: 'text-emerald-400',
      label: '\u2713 Added',
    },
    error: {
      bg: 'bg-red-500/10 border border-red-500/30',
      text: 'text-red-400',
      label: '\u2715 Error',
    },
  }

  const btn = buttonConfig[state]

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2 rounded-2xl border border-zinc-800/60 bg-[#0d0d1a] px-4 py-3 focus-within:border-[#6366f1]/50 transition-colors">
        <span className="text-zinc-500 text-base select-none" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block">
            <path d="M6.5 11.5L4.5 13.5C3.67 14.33 2.33 14.33 1.5 13.5C0.67 12.67 0.67 11.33 1.5 10.5L5.5 6.5C6.33 5.67 7.67 5.67 8.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M9.5 4.5L11.5 2.5C12.33 1.67 13.67 1.67 14.5 2.5C15.33 3.33 15.33 4.67 14.5 5.5L10.5 9.5C9.67 10.33 8.33 10.33 7.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </span>

        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste Yupoo album or gallery link..."
          disabled={disabled || state === 'loading'}
          className="flex-1 bg-transparent outline-none text-zinc-200 placeholder-zinc-600 text-sm"
        />

        <AnimatePresence mode="wait">
          <motion.button
            key={state}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            onClick={handleSubmit}
            disabled={disabled || state === 'loading' || !url.trim()}
            className={[
              'px-4 py-1.5 rounded-xl text-[11px] font-bold tracking-wide whitespace-nowrap transition-colors',
              btn.bg,
              btn.text,
              '',
              disabled || (!url.trim() && state === 'idle') ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {state === 'loading' ? (
              <span className="inline-block animate-spin">{btn.label}</span>
            ) : (
              btn.label
            )}
          </motion.button>
        </AnimatePresence>
      </div>

      <label className="flex items-center gap-2 mt-2 ml-1 cursor-pointer">
        <input
          type="checkbox"
          checked={bulk}
          onChange={(e) => setBulk(e.target.checked)}
          className="accent-[#6366f1]"
        />
        <span className="text-zinc-500 text-xs">
          Bulk mode &mdash; paste multiple URLs (one per line)
        </span>
      </label>
    </motion.div>
  )
}
