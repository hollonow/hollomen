import { NextResponse } from 'next/server'
import { fetchAllProducts } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const data = await fetchAllProducts()
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (err) {
    console.error('[/api/data]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
