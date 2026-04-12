'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'

// Client-side page that handles Supabase hash-based tokens.
// Supabase appends #access_token=...&type=recovery|invite to the redirectTo URL.
// Hashes never reach the server, so /auth/callback can't process them.
// This page lets the browser client read the hash, establish the session,
// then route to the correct destination.
export default function AuthConfirmPage() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Parse the type out of the URL hash before Supabase consumes it.
    const hash = window.location.hash
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const type = params.get('type') // 'recovery' | 'invite' | 'signup' | etc.

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && type === 'recovery')) {
        router.replace('/reset-password')
      } else if (event === 'SIGNED_IN' && type === 'invite') {
        router.replace('/auth/set-password')
      } else if (event === 'SIGNED_IN') {
        router.replace('/')
      }
    })

    // Trigger session detection from the hash fragment.
    supabase.auth.getSession()

    return () => subscription.unsubscribe()
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
