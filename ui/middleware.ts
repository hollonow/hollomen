import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // Auth pages manage their own session — skip the guard so the invite/reset
  // flows can complete without being redirected mid-flight.
  const { pathname } = request.nextUrl
  if (
    pathname === '/login' ||
    pathname === '/reset-password' ||
    pathname.startsWith('/auth/')
  ) {
    return NextResponse.next()
  }

  return updateSession(request)
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
