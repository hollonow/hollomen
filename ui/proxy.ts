import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  // Auth pages manage their own session — bypass the guard so invite/reset
  // flows can complete without being redirected mid-flight.
  const { pathname } = request.nextUrl
  if (
    pathname === '/login' ||
    pathname === '/reset-password' ||
    pathname.startsWith('/auth/')
  ) {
    return NextResponse.next()
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
