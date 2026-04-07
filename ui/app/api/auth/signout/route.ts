import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function handleSignOut(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url))
}

// <a href="/api/auth/signout"> sends GET — must handle it
export async function GET(request: Request) {
  return handleSignOut(request)
}

// Programmatic fetch('/api/auth/signout', { method: 'POST' }) path
export async function POST(request: Request) {
  return handleSignOut(request)
}
