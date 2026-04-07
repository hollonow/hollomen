'use client'

import { Product } from '@/types'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { statusLabel, cleanBrand } from '@/lib/status'

// ── Status color map ─────────────────────────────────────────────────────────
function statusColor(status: string): string {
  if (!status) return 'var(--text-muted)'
  if (status.includes('FAILED')) return 'var(--error)'
  if (['LIVE', 'PUBLISHED'].includes(status)) return 'var(--success)'
  if (status === 'NEEDS_REVIEW') return 'var(--warning)'
  if (status === 'PENDING_APPROVAL') return 'var(--indigo)'
  if (status === 'PUBLISHING') return '#F59E0B'
  if (['APPROVED_FOR_PUBLISH'].includes(status)) return 'var(--indigo)'
  if (['SCRAPPED'].includes(status)) return 'var(--error)'
  // All READY_FOR_* / active processing states
  return 'var(--teal)'
}

function statusBorderColor(status: string): string {
  if (!status) return 'var(--border)'
  if (status.includes('FAILED')) return 'var(--error)'
  if (['LIVE', 'PUBLISHED'].includes(status)) return 'var(--success)'
  if (status === 'NEEDS_REVIEW') return 'var(--warning)'
  if (status === 'PENDING_APPROVAL') return 'var(--indigo)'
  if (status === 'PUBLISHING') return '#F59E0B'
  if (status === 'APPROVED_FOR_PUBLISH') return 'var(--indigo)'
  if (status === 'SCRAPPED') return 'rgba(148,163,184,0.5)'
  return 'var(--teal)'
}

function statusBg(status: string): string {
  if (!status) return 'var(--surface-2)'
  if (status.includes('FAILED')) return 'var(--error-dim)'
  if (['LIVE', 'PUBLISHED'].includes(status)) return 'var(--success-dim)'
  if (status === 'NEEDS_REVIEW') return 'var(--warning-dim)'
  if (status === 'PENDING_APPROVAL') return 'var(--indigo-dim)'
  if (status === 'PUBLISHING') return '#FEF3C7'
  if (status === 'APPROVED_FOR_PUBLISH') return 'var(--indigo-dim)'
  return 'var(--teal-dim)'
}

function getSourceDomain(url: string): string | null {
  try { return new URL(url).hostname.replace('www.', '') } catch { return null }
}

const QUEUE_STATUSES = new Set([
  'READY_FOR_SCRAPE', 'READY_FOR_RESEARCH', 'READY_FOR_SEO',
  'READY_FOR_PUBLISH', 'PUBLISHED',
])

interface Props {
  product: Product
  onReview?: (product: Product) => void
  onDetail?: (product: Product) => void
  onPrioritize?: (product: Product) => void
  onRetry?: (product: Product) => void
  onRecover?: () => void
  selectable?: boolean
  selected?: boolean
  onSelect?: (product: Product) => void
  onToggleSelect?: (id: string) => void
}

export default function ProductCard({ product: p, onReview, onDetail, onPrioritize, onRetry, onRecover, selectable, selected, onSelect, onToggleSelect }: Props) {
  const [prioritized, setPrioritized] = useState(false)
  const [prioritizing, setPrioritizing] = useState(false)

  const status     = p.status ?? ''
  const color      = statusColor(status)
  const borderLeft = statusBorderColor(status)
  const badgeBg    = statusBg(status)
  const label      = status.includes('FAILED') ? 'FAILED' : statusLabel(status)

  const isReview   = status === 'NEEDS_REVIEW'
  const isFailed   = status.includes('FAILED')
  const isScrapped = status === 'SCRAPPED'
  const isLive     = status === 'LIVE'
  const isQueued   = QUEUE_STATUSES.has(status)

  async function handlePrioritize(e: React.MouseEvent) {
    e.stopPropagation()
    if (prioritizing || prioritized) return
    setPrioritizing(true)
    try {
      const res = await fetch('/api/prioritize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: p.product_id }),
      })
      if (res.ok) { setPrioritized(true); onPrioritize?.(p) }
    } finally { setPrioritizing(false) }
  }

  const imgUrl = p.main_image_id && process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
    ? `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/w_300,c_fill/${p.main_image_id}`
    : null

  const price = p.extracted_price ? `¥${p.extracted_price}` : null

  const webpCount = p.webp_image_count ?? 0
  const imgCount  = p.image_count ?? 0
  const imageCountBadge = webpCount > 0 ? webpCount : imgCount > 0 ? imgCount : null

  const cleanedName  = p.final_product_name
    ? p.final_product_name.replace(/^\[Brand:[^\]]*\]\s*/i, '').trim() || null
    : null
  const isEarlyStage = !cleanedName && !p.designer_brand
  const sourceDomain = isEarlyStage ? getSourceDomain(p.source_url ?? '') : null

  let scrapedDate: string | null = null
  if (p.scraped_at) {
    try {
      scrapedDate = new Date(p.scraped_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch { scrapedDate = null }
  }

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
      whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)' }}
      transition={{ duration: 0.18 }}
      onClick={() => onDetail?.(p)}
      style={{
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface)',
        borderRadius: 12,
        border: `1px solid ${isReview ? 'rgba(217,119,6,0.3)' : isFailed ? 'rgba(220,38,38,0.2)' : 'var(--border)'}`,
        borderLeft: `3px solid ${borderLeft}`,
        overflow: 'hidden',
        cursor: onDetail || selectable ? 'pointer' : 'default',
        boxShadow: selected ? `0 0 0 2px var(--indigo)` : 'var(--shadow-xs)',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Image */}
      <div style={{ position: 'relative' }}>
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={p.final_product_name || ''}
            style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block', background: 'var(--surface-2)' }}
            onError={e => {
              const t = e.currentTarget
              t.style.display = 'none';
              (t.nextSibling as HTMLElement | null)?.style.setProperty('display', 'flex')
            }}
          />
        ) : null}
        <div style={{
          width: '100%', aspectRatio: '3/4',
          background: 'var(--surface-2)',
          display: imgUrl ? 'none' : 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 36, color: 'var(--border-md)',
        }}>
          ☐
        </div>

        {/* Status badge */}
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 6,
            background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)',
            border: `1px solid ${badgeBg}`,
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
            letterSpacing: '0.8px', textTransform: 'uppercase', color,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {label}
          </div>
        </div>

        {/* Selection checkbox */}
        {selectable && (
          <div
            style={{ position: 'absolute', top: 8, right: 8, zIndex: 20 }}
            onClick={e => { e.stopPropagation(); onToggleSelect ? onToggleSelect(p.product_id) : onSelect?.(p) }}
          >
            <div style={{
              width: 20, height: 20, borderRadius: '50%', border: `2px solid ${selected ? 'var(--indigo)' : 'var(--border-md)'}`,
              background: selected ? 'var(--indigo)' : 'rgba(255,255,255,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: selected ? '#fff' : 'transparent',
            }}>
              ✓
            </div>
          </div>
        )}

        {/* Image count badge */}
        {imageCountBadge !== null && (
          <div style={{
            position: 'absolute', top: 8, right: selectable ? 34 : 8,
            padding: '2px 6px', borderRadius: 5,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            border: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: 'var(--text-muted)',
          }}>
            {imageCountBadge} imgs
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '10px 12px 12px', gap: 3 }}>

        {/* Brand */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--teal)' }}>
          {cleanBrand(p.designer_brand || p.extracted_brand) ?? (sourceDomain ?? '—')}
        </div>

        {/* Name */}
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.35, flex: 1 }}>
          {cleanedName || (sourceDomain ?? '—')}
        </div>

        {/* Meta */}
        {p.product_type && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.product_type}
          </div>
        )}
        {price && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{price}</div>
        )}
        {p.target_store && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {p.target_store}
          </div>
        )}
        {scrapedDate && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 'auto', paddingTop: 2 }}>{scrapedDate}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {isQueued && !selectable && (
            <button
              onClick={handlePrioritize}
              disabled={prioritizing || prioritized}
              title="Jump to front of queue"
              style={{
                padding: '5px 8px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: prioritizing || prioritized ? 'default' : 'pointer',
                border: `1px solid ${prioritized ? 'var(--success-border)' : 'var(--border-md)'}`,
                background: prioritized ? 'var(--success-dim)' : 'var(--surface-2)',
                color: prioritized ? 'var(--success)' : 'var(--text-muted)',
                transition: 'all 0.13s',
              }}
              onMouseEnter={e => { if (!prioritized && !prioritizing) { e.currentTarget.style.borderColor = 'var(--teal-glow)'; e.currentTarget.style.color = 'var(--teal)' } }}
              onMouseLeave={e => { if (!prioritized) { e.currentTarget.style.borderColor = 'var(--border-md)'; e.currentTarget.style.color = 'var(--text-muted)' } }}
            >
              {prioritized ? '✓' : prioritizing ? '…' : '↑'}
            </button>
          )}
          {isReview && onReview && (
            <button
              onClick={e => { e.stopPropagation(); onReview(p) }}
              style={{
                flex: 1, padding: '5px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: 'var(--warning-dim)', border: '1px solid var(--warning-border)', color: 'var(--warning)',
                transition: 'all 0.13s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FDE68A' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--warning-dim)' }}
            >
              Review
            </button>
          )}
          {isFailed && onRetry && (
            <button
              onClick={e => { e.stopPropagation(); onRetry(p) }}
              style={{
                flex: 1, padding: '5px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: 'var(--error-dim)', border: '1px solid var(--error)', color: 'var(--error)',
                transition: 'all 0.13s',
              }}
            >
              ↺ Retry
            </button>
          )}
          {isScrapped && onRecover && (
            <button
              onClick={e => { e.stopPropagation(); onRecover() }}
              style={{
                flex: 1, padding: '5px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)',
                transition: 'all 0.13s',
              }}
            >
              ↩ Recover
            </button>
          )}
          {isLive && p.store_url && (
            <a
              href={p.store_url}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1, padding: '5px', borderRadius: 7, fontSize: 11, fontWeight: 600, textAlign: 'center',
                background: 'var(--success-dim)', border: '1px solid var(--success-border)', color: 'var(--success)',
                transition: 'all 0.13s', display: 'block',
              }}
            >
              View Live ↗
            </a>
          )}
          {p.storage_folder_url && (
            <a
              href={p.storage_folder_url}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              title="Open folder"
              style={{
                padding: '5px 8px', borderRadius: 7, fontSize: 11,
                background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)',
                transition: 'all 0.13s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-md)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              ↗
            </a>
          )}
        </div>
      </div>
    </motion.div>
  )
}
