import { createClient } from '@supabase/supabase-js'
import { Product, Stats, RunSession, PipelineLog } from '@/types'

function getClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

export async function fetchAllProducts(): Promise<{ products: Product[]; stats: Stats }> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const products = (data ?? []) as Product[]
  return { products, stats: calcStats(products) }
}

export async function appendRow(data: Partial<Product>): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from('products').insert(data)
  if (error) throw new Error(error.message)
}

export async function appendRows(rows: Partial<Product>[]): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase.from('products').insert(rows).select('product_id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

export async function updateRow(productId: string, data: Partial<Product>): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from('products')
    .update(data)
    .eq('product_id', productId)
  if (error) throw new Error(error.message)
}

export async function deleteRow(productId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('product_id', productId)
  if (error) throw new Error(error.message)
}

export async function deleteRows(productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0
  const supabase = getClient()
  const { error, count } = await supabase
    .from('products')
    .delete({ count: 'exact' })
    .in('product_id', productIds)
  if (error) throw new Error(error.message)
  return count ?? productIds.length
}

export async function deleteRunSession(sessionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from('run_sessions')
    .delete()
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

export async function fetchRunSessions(limit = 100): Promise<RunSession[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('run_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as RunSession[]
}

export async function fetchSessionLogs(sessionId: string): Promise<PipelineLog[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('pipeline_logs')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as PipelineLog[]
}

function calcStats(products: Product[]): Stats {
  const s: Stats = { total: 0, pending_approval: 0, needs_review: 0, failed: 0, in_progress: 0, live: 0 }
  for (const p of products) {
    s.total++
    const st = p.status ?? ''
    if (st === 'LIVE')                s.live++
    else if (st === 'PENDING_APPROVAL') s.pending_approval++
    else if (st === 'NEEDS_REVIEW')   s.needs_review++
    else if (st.includes('FAILED'))   s.failed++
    else s.in_progress++
  }
  return s
}
