'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Supabase always redirects to the Site URL (this page) with tokens in the hash.
    // We intercept here and call setSession() directly so the user reaches the right page.
    const hash = window.location.hash.replace(/^#/, '')
    const hashParams = new URLSearchParams(hash)
    const accessToken  = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const type         = hashParams.get('type')
    const errorCode    = hashParams.get('error_code')

    if (errorCode) {
      setError('That link has expired or is invalid. Please request a new one.')
      return
    }

    if (accessToken && refreshToken) {
      // Clear the hash from the URL bar so tokens aren't visible
      window.history.replaceState(null, '', window.location.pathname)
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) { setError('Authentication failed. Please try again.'); return }
          if (type === 'recovery') router.replace('/reset-password')
          else if (type === 'invite') router.replace('/auth/set-password')
          else router.replace('/')
        })
      return
    }

    // Query-param errors from /auth/confirm or /auth/callback
    const queryParams = new URLSearchParams(window.location.search)
    const err = queryParams.get('error') ?? ''
    if (err.includes('expired') || err === 'link_invalid') {
      setError('That link has expired. Please request a new one.')
    } else if (err === 'auth_failed' || err === 'auth_callback_failed') {
      setError('Authentication failed. Please try again.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm`,
    })

    if (error) {
      setError(error.message)
    } else {
      setMessage('Check your email for a password reset link.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white tracking-tight">HolloEngine</h1>
          <p className="text-sm text-zinc-500 mt-1">Pipeline Dashboard</p>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>

            {error && <p className="text-red-400 text-xs px-1">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black rounded-lg px-4 py-3 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            <p className="text-center">
              <button
                type="button"
                onClick={() => { setMode('reset'); setError('') }}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Forgot password?
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>

            {error && <p className="text-red-400 text-xs px-1">{error}</p>}
            {message && <p className="text-green-400 text-xs px-1">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black rounded-lg px-4 py-3 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>

            <p className="text-center">
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setMessage('') }}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Back to sign in
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
