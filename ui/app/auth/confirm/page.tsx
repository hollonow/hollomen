'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'

// Handles Supabase hash-based auth tokens.
// Supabase appends #access_token=...&type=recovery|invite to the redirectTo URL.
// Hashes never reach the server, so /auth/callback can't process them.
// We extract tokens directly from the hash and call setSession() explicitly.
export default function AuthConfirmPage() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search)
    const tokenHash   = queryParams.get('token_hash')
    const queryType   = queryParams.get('type') as 'recovery' | 'invite' | null

    // PKCE flow (newer Supabase default): token arrives as ?token_hash=...&type=...
    if (tokenHash && queryType) {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: queryType })
        .then(({ error }) => {
          if (error) { router.replace('/login?error=link_invalid'); return }
          if (queryType === 'recovery') router.replace('/reset-password')
          else if (queryType === 'invite') router.replace('/auth/set-password')
          else router.replace('/')
        })
      return
    }

    // Implicit flow (legacy): token arrives as #access_token=...&refresh_token=...
    const hash       = window.location.hash.replace(/^#/, '')
    const params     = new URLSearchParams(hash)
    const accessToken  = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const type         = params.get('type') as 'recovery' | 'invite' | null
    const errorCode    = params.get('error_code')
    const errorDesc    = params.get('error_description')

    if (errorCode || !accessToken || !refreshToken) {
      const msg = errorDesc
        ? encodeURIComponent(errorDesc.replace(/\+/g, ' '))
        : 'link_invalid'
      router.replace(`/login?error=${msg}`)
      return
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) { router.replace('/login?error=auth_failed'); return }
        if (type === 'recovery') router.replace('/reset-password')
        else if (type === 'invite') router.replace('/auth/set-password')
        else router.replace('/')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          border: '2px solid #3f3f46', borderTopColor: '#0d9488',
          animation: 'spin 0.7s linear infinite',
        }} />
        <p className="text-sm text-zinc-500">Verifying…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
