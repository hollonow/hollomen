'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [checking, setChecking] = useState(true)
  const router   = useRouter()
  const supabase = createClient()

  // Guard: only reachable via invite link (session set by /auth/callback).
  // If no session, the user navigated here directly — send them to login.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
      else setChecking(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  if (checking) return null

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white tracking-tight">HolloEngine</h1>
          <p className="text-sm text-zinc-500 mt-1">Set your password to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Choose a password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-zinc-600 transition-colors"
          />

          {error && <p className="text-red-400 text-xs px-1">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black rounded-lg px-4 py-3 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Setting password…' : 'Set password & enter dashboard'}
          </button>
        </form>
      </div>
    </div>
  )
}
