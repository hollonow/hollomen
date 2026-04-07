'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import type { Product } from '@/types'
import ProductDetail from '@/components/ProductDetail'
import ProductCard from '@/components/ProductCard'
import ReviewModal from '@/components/ReviewModal'
import Topbar from '@/components/Topbar'
import { statusLabel, cleanBrand } from '@/lib/status'
import { motion } from 'framer-motion'

type ViewMode = 'table' | 'grid'

const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`

type FilterTab = 'all' | 'PENDING_APPROVAL' | 'NEEDS_REVIEW' | 'progress' | 'failed' | 'SCRAPPED'

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',              label: 'All' },
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'NEEDS_REVIEW',     label: 'Needs Review' },
  { key: 'progress',         label: 'In Progress' },
  { key: 'failed',           label: 'Failed' },
  { key: 'SCRAPPED',         label: 'Scrapped' },
]

const IN_PROGRESS_STATUSES = new Set([
  'READY_FOR_SCRAPE', 'SCRAPING', 'READY_FOR_RESEARCH', 'RESEARCHING',
  'READY_FOR_SEO', 'WRITING_SEO', 'READY_FOR_PUBLISH', 'OPTIMIZING', 'PUBLISHING',
])

function pillStyle(status: string): React.CSSProperties {
  if (status?.includes('FAILED')) return { background: 'var(--error-dim)',   color: 'var(--error)' }
  if (status === 'NEEDS_REVIEW')  return { background: 'var(--warning-dim)', color: 'var(--warning)' }
  if (status === 'PENDING_APPROVAL') return { background: 'var(--indigo-dim)', color: 'var(--indigo)' }
  if (status === 'PUBLISHED' || status === 'LIVE') return { background: 'var(--success-dim)', color: 'var(--success)' }
  if (status === 'SCRAPPED')      return { background: 'rgba(68,68,90,0.2)', color: 'var(--text-muted)' }
  return { background: 'var(--accent-dim)', color: 'var(--accent)' }
}

function productName(p: Product): string {
  const raw = p.cms_title || p.final_product_name || p.english_name_draft || ''
  const cleaned = raw.replace(/^\[Brand:[^\]]*\]\s*/i, '').trim()
  if (cleaned) return cleaned
  if (!p.status || p.status === 'READY_FOR_SCRAPE') return 'Queued · Pending scrape'
  return 'Unidentified Product'
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

// ---------------------------------------------------------------------------
// Row — own component so hover state is per-row
// ---------------------------------------------------------------------------
function TableRow({ p, onApprove, onOpenReview, onDetail, onRetry, onRecover, selected, onToggleSelect }: {
  p: Product
  onApprove: (id: string, action: 'approve' | 'reject') => void
  onOpenReview: (p: Product) => void
  onDetail: (p: Product) => void
  onRetry: (p: Product) => void
  onRecover: (id: string) => void
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const isReview   = p.status === 'NEEDS_REVIEW'
  const isFailed   = (p.status ?? '').includes('FAILED')
  const isScrapped = p.status === 'SCRAPPED'
  const imageUrl = p.main_image_id ? `${CLOUDINARY_BASE}/w_80,h_80,c_fill/${p.main_image_id}` : null
  const name  = productName(p)
  const brand = cleanBrand(p.designer_brand || p.extracted_brand) ?? '—'
  const ps    = pillStyle(p.status ?? '')

  return (
    <tr
      onClick={() => onDetail(p)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: '1px solid var(--border)',
        background: hovered ? 'var(--surface-2)' : 'transparent',
        borderLeft: isReview ? '2px solid var(--warning)' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
    >
      {/* Checkbox */}
      <td style={{ padding: '10px 8px', width: 32 }} onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(p.product_id)}
          style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
        />
      </td>

      {/* Thumbnail */}
      <td style={{ padding: '10px 12px', width: 52 }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)', flexShrink: 0 }}>
          {imageUrl
            ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            : null}
        </div>
      </td>

      {/* Product */}
      <td style={{ padding: '10px 12px', maxWidth: 240 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
      </td>

      {/* Brand */}
      <td style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{brand}</td>

      {/* Type */}
      <td style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.product_type || '—'}</td>

      {/* Status */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <span style={{
          ...ps,
          fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
          padding: '3px 9px', borderRadius: 5, display: 'inline-block',
        }}>
          {statusLabel(p.status)}
        </span>
      </td>

      {/* Date */}
      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
        {formatDate(p.scraped_at)}
      </td>

      {/* Actions */}
      <td style={{ padding: '10px 12px', opacity: hovered ? 1 : 0, transition: 'opacity 120ms ease' }} onClick={e => e.stopPropagation()}>
        {isReview && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onOpenReview(p)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
                background: 'var(--surface-2)', border: '1px solid var(--warning)', color: 'var(--warning)',
                transition: 'all 120ms ease',
              }}
            >
              Review
            </button>
            <button
              onClick={() => onApprove(p.product_id, 'reject')}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
                background: 'var(--surface-2)', border: '1px solid var(--error)', color: 'var(--error)',
                transition: 'all 120ms ease',
              }}
            >
              Reject
            </button>
          </div>
        )}
        {isFailed && (
          <button
            onClick={() => onRetry(p)}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
              background: 'var(--surface-2)', border: '1px solid var(--error)', color: 'var(--error)',
              transition: 'all 120ms ease',
            }}
          >
            ↺ Retry
          </button>
        )}
        {isScrapped && (
          <button
            onClick={() => onRecover(p.product_id)}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
              background: 'var(--surface-2)', border: '1px solid var(--accent)', color: 'var(--accent)',
              transition: 'all 120ms ease',
            }}
          >
            ↩ Recover
          </button>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  const [products, setProducts]    = useState<Product[]>([])
  const [loading, setLoading]      = useState(true)
  const [toast, setToast]          = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [filterTab, setFilterTab]  = useState<FilterTab>('all')
  const [query, setQuery]          = useState('')
  const [viewMode, setViewMode]    = useState<ViewMode>('table')
  const [detailProduct, setDetail] = useState<Product | null>(null)
  const [selected, setSelected]    = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [reviewProduct, setReviewProduct] = useState<Product | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase   = useMemo(() => createClient(), [])

  function showToast(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type })
    if (toastTimer.current != null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/data')
      const data = await res.json()
      setProducts(data.products ?? [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const channel = supabase
      .channel('pipeline-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, loadData])

  async function handleApprove(productId: string, action: 'approve' | 'reject') {
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, action }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast(action === 'approve' ? 'Approved — moving to SEO' : 'Rejected — marked SCRAPPED', 'ok')
      loadData()
    } catch {
      showToast('Action failed', 'err')
    }
  }

  async function handleRetry(p: Product) {
    try {
      const res = await fetch('/api/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: p.product_id, current_status: p.status }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Requeued — run the agent to process', 'ok')
      loadData()
    } catch {
      showToast('Retry failed', 'err')
    }
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selected.size} product(s)? This permanently removes them from Cloudinary and the database.`)) return
    setBulkWorking(true)
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: [...selected] }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(`Deleted ${data.deleted} product${data.deleted !== 1 ? 's' : ''}`, 'ok')
        setSelected(new Set())
      } else {
        showToast('Delete failed', 'err')
      }
    } catch {
      showToast('Delete failed', 'err')
    }
    setBulkWorking(false)
    loadData()
  }

  async function handleBulkRetry() {
    setBulkWorking(true)
    const failedIds = [...selected].filter(id =>
      products.find(p => p.product_id === id)?.status?.includes('FAILED')
    )
    const agentsSeen = new Set<number>()
    for (const id of failedIds) {
      try {
        const p = products.find(p => p.product_id === id)
        const res = await fetch('/api/requeue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: id, current_status: p?.status }),
        })
        const data = await res.json()
        if (data.agent) agentsSeen.add(data.agent)
      } catch { /* continue */ }
    }
    for (const agent of agentsSeen) {
      await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent }),
      })
    }
    showToast(`Retrying ${failedIds.length} product${failedIds.length !== 1 ? 's' : ''}`, 'ok')
    setSelected(new Set())
    setBulkWorking(false)
    loadData()
  }

  async function handleRecover(productId: string) {
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, action: 'rerun' }),
      })
      if (res.ok) {
        showToast('Product recovered — sent to READY_FOR_RESEARCH', 'ok')
        loadData()
      } else {
        showToast('Recovery failed', 'err')
      }
    } catch {
      showToast('Recovery failed', 'err')
    }
  }

  async function handleBulkApprove() {
    const reviewIds = Array.from(selected).filter(id => {
      const p = products.find(p => p.product_id === id)
      return p?.status === 'NEEDS_REVIEW'
    })
    if (reviewIds.length === 0) return
    setBulkWorking(true)
    let done = 0
    for (const id of reviewIds) {
      await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: id, action: 'approve' }),
      })
      done++
    }
    setBulkWorking(false)
    setSelected(new Set())
    showToast(`Approved ${done} product${done !== 1 ? 's' : ''} — moving to SEO`, 'ok')
    loadData()
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function exportProductsCSV() {
    const headers = [
      'Product ID', 'Brand', 'Product Name', 'Type', 'Status',
      'SEO Title', 'Extracted Price (¥)', 'Images', 'WebP Images',
      'Scraped', 'Researched', 'Optimised', 'Published', 'WooCommerce URL',
    ]
    const rows = sortedProducts.map(p => [
      p.product_id,
      cleanBrand(p.designer_brand || p.extracted_brand) ?? '',
      productName(p),
      p.product_type ?? '',
      statusLabel(p.status ?? ''),
      p.cms_title ?? '',
      p.extracted_price ?? '',
      p.image_count ?? 0,
      p.webp_image_count ?? 0,
      formatDate(p.scraped_at),
      formatDate(p.researched_at),
      formatDate(p.optimized_at),
      formatDate(p.published_at),
      p.store_url ?? '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `hollomen-${filterTab}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const [sortField, setSortField] = useState<'name' | 'brand' | 'type' | 'status' | 'date' | null>(null)
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc')

  function toggleSort(field: 'name' | 'brand' | 'type' | 'status' | 'date') {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const s = p.status ?? ''
      if (filterTab === 'NEEDS_REVIEW'     && s !== 'NEEDS_REVIEW')     return false
      if (filterTab === 'PENDING_APPROVAL' && s !== 'PENDING_APPROVAL') return false
      if (filterTab === 'failed'   && !s.includes('FAILED'))            return false
      if (filterTab === 'SCRAPPED' && s !== 'SCRAPPED')                 return false
      if (filterTab === 'progress' && !IN_PROGRESS_STATUSES.has(s))     return false
      if (filterTab === 'all'      && s === 'SCRAPPED')                  return false

      if (query) {
        const hay = [p.designer_brand, p.final_product_name, p.cms_title, p.product_type]
          .join(' ').toLowerCase()
        if (!hay.includes(query.toLowerCase())) return false
      }
      return true
    })
  }, [products, filterTab, query])

  const sortedProducts = useMemo(() => {
    if (!sortField) return filteredProducts
    return [...filteredProducts].sort((a, b) => {
      let av = '', bv = ''
      if (sortField === 'name')   { av = productName(a);                                          bv = productName(b) }
      if (sortField === 'brand')  { av = cleanBrand(a.designer_brand || a.extracted_brand) ?? ''; bv = cleanBrand(b.designer_brand || b.extracted_brand) ?? '' }
      if (sortField === 'type')   { av = a.product_type ?? '';                                    bv = b.product_type ?? '' }
      if (sortField === 'status') { av = a.status ?? '';                                          bv = b.status ?? '' }
      if (sortField === 'date')   { av = a.scraped_at ?? '';                                      bv = b.scraped_at ?? '' }
      const cmp = av.localeCompare(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredProducts, sortField, sortDir])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar title="Pipeline" onRefresh={loadData} refreshing={loading} />

      {/* Filter row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 32px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        gap: 12,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTER_TABS.map(tab => {
            const active = filterTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setFilterTab(tab.key)}
                style={{
                  padding: '6px 14px', borderRadius: 7, fontSize: 13,
                  fontFamily: 'var(--font-body)',
                  background: active ? 'var(--accent-dim)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  border: `1px solid ${active ? 'var(--accent-glow)' : 'transparent'}`,
                  transition: 'all 150ms ease',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search brand, product…"
            style={{
              background: 'var(--surface)', border: '1px solid var(--border-md)',
              borderRadius: 8, padding: '7px 14px', fontSize: 13,
              color: 'var(--text-primary)', fontFamily: 'var(--font-body)', width: 220,
              outline: 'none',
            }}
          />

          {/* Export CSV */}
          <button
            onClick={exportProductsCSV}
            disabled={sortedProducts.length === 0}
            title={`Export ${sortedProducts.length} products as CSV`}
            style={{
              padding: '7px 13px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: '1px solid var(--border-md)',
              background: 'var(--surface-2)', color: 'var(--text-muted)',
              cursor: sortedProducts.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 150ms ease', opacity: sortedProducts.length === 0 ? 0.4 : 1,
              fontFamily: 'var(--font-body)',
            }}
            onMouseEnter={e => { if (sortedProducts.length > 0) { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--accent-glow)' } }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-md)' }}
          >
            ↓ CSV
          </button>

          {/* View toggle */}
          <div style={{
            display: 'flex', gap: 2,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 3,
          }}>
            {([
              { mode: 'table' as ViewMode, icon: (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="2" width="12" height="1.5" rx="0.75" fill="currentColor"/>
                  <rect x="1" y="5.5" width="12" height="1.5" rx="0.75" fill="currentColor"/>
                  <rect x="1" y="9" width="12" height="1.5" rx="0.75" fill="currentColor"/>
                  <rect x="1" y="12" width="7" height="1.5" rx="0.75" fill="currentColor"/>
                </svg>
              )},
              { mode: 'grid' as ViewMode, icon: (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor"/>
                  <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor"/>
                  <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor"/>
                  <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor"/>
                </svg>
              )},
            ] as { mode: ViewMode; icon: React.ReactNode }[]).map(({ mode, icon }) => {
              const active = viewMode === mode
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  title={mode === 'table' ? 'Table view' : 'Grid view'}
                  style={{
                    width: 30, height: 30, borderRadius: 6,
                    background: active ? 'var(--surface)' : 'transparent',
                    border: active ? '1px solid var(--border-md)' : '1px solid transparent',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: 'all 150ms ease',
                  }}
                >
                  {icon}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content — Table or Grid */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {viewMode === 'table' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)', borderBottom: '1px solid var(--border-md)' }}>
              <tr>
                <th style={{ width: 32, padding: '10px 8px' }} onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={sortedProducts.length > 0 && sortedProducts.every(p => selected.has(p.product_id))}
                    onChange={() => {
                      const allSelected = sortedProducts.every(p => selected.has(p.product_id))
                      if (allSelected) {
                        setSelected(prev => { const next = new Set(prev); sortedProducts.forEach(p => next.delete(p.product_id)); return next })
                      } else {
                        setSelected(prev => { const next = new Set(prev); sortedProducts.forEach(p => next.add(p.product_id)); return next })
                      }
                    }}
                    style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
                  />
                </th>
                <th style={{ width: 52 }} />
                {(['name', 'brand', 'type', 'status', 'date'] as const).map(field => (
                  <th
                    key={field}
                    onClick={() => toggleSort(field)}
                    style={{ padding: '10px 12px', textAlign: 'left', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.5px', color: sortField === field ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  >
                    {field === 'name' ? 'Product' : field.charAt(0).toUpperCase() + field.slice(1)}{' '}
                    <span style={{ opacity: sortField === field ? 1 : 0.35 }}>{sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </th>
                ))}
                <th style={{ padding: '10px 12px', textAlign: 'left', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Loading…
                  </td>
                </tr>
              ) : sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No products
                  </td>
                </tr>
              ) : (
                sortedProducts.map(p => (
                  <TableRow
                    key={p.product_id}
                    p={p}
                    onApprove={handleApprove}
                    onOpenReview={setReviewProduct}
                    onDetail={setDetail}
                    onRetry={handleRetry}
                    onRecover={handleRecover}
                    selected={selected.has(p.product_id)}
                    onToggleSelect={toggleSelect}
                  />
                ))
              )}
            </tbody>
          </table>
        ) : (
          /* Grid view */
          loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading…
            </div>
          ) : sortedProducts.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No products
            </div>
          ) : (
            <div>
              {/* Grid Select All bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 32px 0', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={sortedProducts.length > 0 && sortedProducts.every(p => selected.has(p.product_id))}
                  onChange={() => {
                    const allSelected = sortedProducts.every(p => selected.has(p.product_id))
                    if (allSelected) {
                      setSelected(prev => { const next = new Set(prev); sortedProducts.forEach(p => next.delete(p.product_id)); return next })
                    } else {
                      setSelected(prev => { const next = new Set(prev); sortedProducts.forEach(p => next.add(p.product_id)); return next })
                    }
                  }}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  {sortedProducts.every(p => selected.has(p.product_id)) && sortedProducts.length > 0 ? 'Deselect All' : 'Select All'} ({sortedProducts.length})
                </span>
              </div>
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: 16,
                padding: '20px 32px',
              }}
            >
              {sortedProducts.map(p => (
                <ProductCard
                  key={p.product_id}
                  product={p}
                  onDetail={setDetail}
                  onReview={p.status === 'NEEDS_REVIEW' ? () => setReviewProduct(p) : undefined}
                  onRetry={(p.status ?? '').includes('FAILED') ? handleRetry : undefined}
                  onRecover={p.status === 'SCRAPPED' ? () => handleRecover(p.product_id) : undefined}
                  selectable
                  selected={selected.has(p.product_id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </motion.div>
            </div>
          )
        )}
      </div>

      {/* Review Modal */}
      {reviewProduct && (
        <ReviewModal
          product={reviewProduct}
          onClose={() => setReviewProduct(null)}
          onRefresh={() => { setReviewProduct(null); loadData() }}
        />
      )}

      {/* Detail Modal */}
      {detailProduct && (
        <ProductDetail
          product={detailProduct}
          onClose={() => setDetail(null)}
          onDelete={() => { setDetail(null); loadData() }}
          onToast={showToast}
        />
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (() => {
        const selectedProducts = [...selected].map(id => products.find(p => p.product_id === id)).filter(Boolean) as Product[]
        const hasReview = selectedProducts.some(p => p.status === 'NEEDS_REVIEW')
        const hasFailed = selectedProducts.some(p => (p.status ?? '').includes('FAILED'))
        return (
          <div style={{
            position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
            zIndex: 90,
            background: 'var(--surface-3)', border: '1px solid var(--border-bright)',
            borderRadius: 10, padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: 'var(--shadow-md)',
          }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', paddingRight: 4 }}>
              {selected.size} selected
            </span>
            {hasReview && (
              <button
                onClick={handleBulkApprove}
                disabled={bulkWorking}
                style={{
                  background: 'var(--success-dim)', border: '1px solid var(--success)',
                  color: 'var(--success)', borderRadius: 7, padding: '6px 14px',
                  fontSize: 12.5, fontWeight: 500, fontFamily: 'var(--font-body)',
                  opacity: bulkWorking ? 0.6 : 1, transition: 'opacity 150ms ease',
                }}
              >
                {bulkWorking ? 'Working…' : `✓ Approve ${selectedProducts.filter(p => p.status === 'NEEDS_REVIEW').length}`}
              </button>
            )}
            {hasFailed && (
              <button
                onClick={handleBulkRetry}
                disabled={bulkWorking}
                style={{
                  background: 'var(--warning-dim)', border: '1px solid var(--warning)',
                  color: 'var(--warning)', borderRadius: 7, padding: '6px 14px',
                  fontSize: 12.5, fontWeight: 500, fontFamily: 'var(--font-body)',
                  opacity: bulkWorking ? 0.6 : 1, transition: 'opacity 150ms ease',
                }}
              >
                {bulkWorking ? 'Working…' : `↺ Retry ${selectedProducts.filter(p => (p.status ?? '').includes('FAILED')).length}`}
              </button>
            )}
            <button
              onClick={handleBulkDelete}
              disabled={bulkWorking}
              style={{
                background: 'var(--error-dim)', border: '1px solid var(--error)',
                color: 'var(--error)', borderRadius: 7, padding: '6px 14px',
                fontSize: 12.5, fontWeight: 500, fontFamily: 'var(--font-body)',
                opacity: bulkWorking ? 0.6 : 1, transition: 'opacity 150ms ease',
              }}
            >
              {bulkWorking ? 'Working…' : `🗑 Delete ${selected.size}`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              style={{
                background: 'none', border: 'none', fontSize: 13,
                color: 'var(--text-muted)', cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              Cancel
            </button>
          </div>
        )
      })()}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 100,
          background: 'var(--surface)', border: `1px solid ${toast.type === 'ok' ? 'var(--success)' : 'var(--error)'}`,
          color: toast.type === 'ok' ? 'var(--success)' : 'var(--error)',
          borderRadius: 8, padding: '10px 16px', fontSize: 12.5, fontWeight: 500,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
