import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code      = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type      = searchParams.get('type')   // used for OTP verification; not used for routing
  const next      = searchParams.get('next') ?? '/'

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  if (code) {
    // PKCE flow (e.g. OAuth, magic link)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  } else if (tokenHash && type) {
    // Email OTP flow (password reset, invite links)
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'recovery' | 'invite' | 'email' | 'signup' | 'magiclink' })
    if (error) return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  } else {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // Redirect to next (e.g. /reset-password, /auth/set-password for invites, or / for everything else)
  return NextResponse.redirect(`${origin}${next}`)
}
