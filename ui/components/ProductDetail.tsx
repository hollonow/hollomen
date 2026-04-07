'use client'

import { useEffect, useState } from 'react'
import { Product } from '@/types'
import { statusLabel, cleanBrand } from '@/lib/status'

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, { color: string }> = {
  LIVE:                 { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  PUBLISHED:            { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  NEEDS_REVIEW:         { color: 'text-amber-400   bg-amber-500/10   border-amber-500/30'   },
  PENDING_APPROVAL:     { color: 'text-orange-400  bg-orange-500/10  border-orange-500/30'  },
  PUBLISHING:           { color: 'text-orange-400  bg-orange-500/10  border-orange-500/30'  },
  APPROVED_FOR_PUBLISH: { color: 'text-violet-400  bg-violet-500/10  border-violet-500/30'  },
  READY_FOR_SEO:        { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  WRITING_SEO:          { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  READY_FOR_RESEARCH:   { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  RESEARCHING:          { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  READY_FOR_PUBLISH:    { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  OPTIMIZING:           { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  READY_FOR_SCRAPE:     { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  SCRAPING:             { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  DISCOVERED:           { color: 'text-blue-400    bg-blue-500/10    border-blue-500/30'    },
  SCRAPPED:             { color: 'text-red-400     bg-red-500/10     border-red-500/20'     },
}

function statusMeta(s: string) {
  if (s?.includes('FAILED')) return { label: 'FAILED', color: 'text-red-400 bg-red-500/10 border-red-500/20' }
  const entry = STATUS_MAP[s]
  return { label: statusLabel(s), color: entry?.color ?? 'text-zinc-400 bg-zinc-800 border-zinc-700' }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'UTC',
    })
  } catch { return iso }
}

// ---------------------------------------------------------------------------
// Pipeline progress bar
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = [
  { label: 'Mine',     statuses: ['READY_FOR_SCRAPE'] },
  { label: 'Research', statuses: ['READY_FOR_RESEARCH'] },
  { label: 'Review',   statuses: ['NEEDS_REVIEW'] },
  { label: 'SEO',      statuses: ['READY_FOR_SEO'] },
  { label: 'Optimize', statuses: ['READY_FOR_PUBLISH', 'READY_FOR_UPLOAD'] },
  { label: 'Publish',  statuses: ['PUBLISHED'] },
  { label: 'Complete', statuses: ['PENDING_APPROVAL', 'LIVE'] },
]

function getStageIndex(status: string | null | undefined): number {
  if (!status) return -1
  if (status.includes('FAILED') || status === 'SCRAPPED') return -2
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    if (PIPELINE_STAGES[i].statuses.includes(status)) return i
  }
  return -1
}

function PipelineProgress({ status }: { status: string | null | undefined }) {
  const idx      = getStageIndex(status)
  const isFailed = idx === -2

  return (
    <div className="flex items-start gap-0 w-full">
      {PIPELINE_STAGES.map((stage, i) => {
        const done    = !isFailed && idx > i
        const current = !isFailed && idx === i

        return (
          <div key={stage.label} className="flex items-center flex-1 min-w-0">
            {i > 0 && (
              <div className={`h-px flex-1 mt-1 ${done ? 'bg-emerald-500/50' : 'bg-zinc-800'}`} />
            )}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div className={`
                w-2.5 h-2.5 rounded-full border flex-shrink-0
                ${done    ? 'bg-emerald-500 border-emerald-500' : ''}
                ${current ? 'bg-[#6366f1] border-[#6366f1] shadow-[0_0_8px_rgba(99,102,241,0.7)]' : ''}
                ${isFailed && i === idx ? 'bg-red-500 border-red-500' : ''}
                ${!done && !current ? 'bg-zinc-800 border-zinc-700' : ''}
              `} />
              <span className={`text-[8px] font-semibold whitespace-nowrap
                ${done    ? 'text-emerald-500/60' : ''}
                ${current ? 'text-[#6366f1]' : ''}
                ${!done && !current ? 'text-zinc-700' : ''}
              `}>
                {stage.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">{label}</span>
      <span className={`text-xs text-zinc-300 break-words ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function CharField({ label, value, max }: { label: string; value?: string | null; max: number }) {
  if (!value) return null
  const len  = value.length
  const over = len > max
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">{label}</span>
        <span className={`text-[9px] font-semibold ${over ? 'text-red-400' : 'text-zinc-600'}`}>
          {len}/{max}
        </span>
      </div>
      <span className="text-xs text-zinc-300 break-words">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = 'identity' | 'seo' | 'research' | 'media'
const TABS: { key: Tab; label: string }[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'seo',      label: 'SEO' },
  { key: 'research', label: 'Research' },
  { key: 'media',    label: 'Media' },
]

// ---------------------------------------------------------------------------
// Agent triggers
// ---------------------------------------------------------------------------

const AGENT_TRIGGER: Record<string, { agent: string; label: string; color: string }> = {
  READY_FOR_SCRAPE:   { agent: 'agent1', label: 'Run Agent 1 — Scrape',   color: 'text-blue-400    bg-blue-500/10    border-blue-500/30    hover:bg-blue-500/20'    },
  READY_FOR_RESEARCH: { agent: 'agent2', label: 'Run Agent 2 — Research', color: 'text-violet-400  bg-violet-500/10  border-violet-500/30  hover:bg-violet-500/20'  },
  READY_FOR_SEO:      { agent: 'agent3', label: 'Run Agent 3 — SEO',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20' },
  READY_FOR_PUBLISH:  { agent: 'agent4', label: 'Run Agent 4 — Optimize', color: 'text-amber-400   bg-amber-500/10   border-amber-500/30   hover:bg-amber-500/20'   },
  PUBLISHED:          { agent: 'agent5', label: 'Run Agent 5 — Publish',  color: 'text-pink-400    bg-pink-500/10    border-pink-500/30    hover:bg-pink-500/20'    },
}

const FAILED_RETRY: Record<string, { agent: string; label: string }> = {
  SCRAPE_FAILED:   { agent: 'agent1', label: 'Retry Agent 1 — Scrape'   },
  RESEARCH_FAILED: { agent: 'agent2', label: 'Retry Agent 2 — Research' },
  SEO_FAILED:      { agent: 'agent3', label: 'Retry Agent 3 — SEO'      },
  OPTIMIZE_FAILED: { agent: 'agent4', label: 'Retry Agent 4 — Optimize' },
  PUBLISH_FAILED:  { agent: 'agent5', label: 'Retry Agent 5 — Publish'  },
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  product: Product
  onClose: () => void
  onDelete?: () => void
  onToast?: (msg: string, type: 'ok' | 'err') => void
}

export default function ProductDetail({ product: p, onClose, onDelete, onToast }: Props) {
  const [activeImg, setActiveImg]         = useState<string | null>(null)
  const [tab, setTab]                     = useState<Tab>('identity')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [runningAgent, setRunningAgent]   = useState(false)
  const [retrying, setRetrying]           = useState(false)

  // Gallery
  const [galleryImages, setGalleryImages] = useState<{ id: string; name: string; url: string }[]>([])
  const [lightboxOpen, setLightboxOpen]   = useState(false)
  const [lightboxIdx, setLightboxIdx]     = useState(0)

  useEffect(() => {
    if (!lightboxOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setLightboxOpen(false); return }
      if (e.key === 'ArrowRight') setLightboxIdx(i => { const n = (i + 1) % galleryImages.length; setActiveImg(galleryImages[n].url); return n })
      if (e.key === 'ArrowLeft')  setLightboxIdx(i => { const n = (i - 1 + galleryImages.length) % galleryImages.length; setActiveImg(galleryImages[n].url); return n })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen, galleryImages])

  // SEO edit mode
  const [seoEdit, setSeoEdit]       = useState(false)
  const [seoSaving, setSeoSaving]   = useState(false)
  const [seoSaved, setSeoSaved]     = useState(false)
  const [seoError, setSeoError]     = useState('')
  const [editTitle, setEditTitle]   = useState(p.cms_title ?? '')
  const [editMeta, setEditMeta]     = useState(p.meta_description ?? '')
  const [editDesc, setEditDesc]     = useState(p.product_description ?? '')
  const [editBody, setEditBody]     = useState(p.cms_body_html ?? '')

  async function saveSeo() {
    setSeoSaving(true)
    setSeoError('')
    try {
      const res = await fetch('/api/update-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id:          p.product_id,
          cms_title:           editTitle,
          meta_description:    editMeta,
          product_description: editDesc,
          cms_body_html:       editBody,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')
      setSeoEdit(false)
      setSeoSaved(true)
      setTimeout(() => setSeoSaved(false), 3000)
      onToast?.('SEO fields saved', 'ok')
    } catch (e) {
      setSeoError(String(e))
    } finally {
      setSeoSaving(false)
    }
  }

  const sm    = statusMeta(p.status)
  const score = p.source_reputation_score ?? 0
  const scoreColor = score > 0.6 ? 'bg-emerald-500' : score > 0.3 ? 'bg-amber-500' : 'bg-red-500'
  const links = Array.isArray(p.research_source_links)
    ? p.research_source_links
    : ((p.research_source_links ?? '') as string).split(',').map(s => s.trim()).filter(Boolean)

  useEffect(() => {
    setGalleryImages([])
    setActiveImg(null)
    setLightboxOpen(false)
    setLightboxIdx(0)
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
    if (p.main_image_id && cloudName) {
      setActiveImg(`https://res.cloudinary.com/${cloudName}/image/upload/w_800,c_fill/${p.main_image_id}`)
    }
    // Fetch full gallery
    fetch(`/api/images?product_id=${p.product_id}`)
      .then(r => r.ok ? r.json() : { files: [] })
      .then(data => {
        const files: { id: string; name: string; url: string }[] = data.files ?? []
        setGalleryImages(files)
        // Set lightbox starting index to match hero
        const heroIdx = files.findIndex(f => f.id === p.main_image_id || f.url.includes(p.main_image_id ?? ''))
        setLightboxIdx(heroIdx >= 0 ? heroIdx : 0)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.product_id])

  async function runAgent(agentKey: string) {
    setRunningAgent(true)
    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentKey, productId: p.product_id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      onToast?.(`Started for ${p.product_id}`, 'ok')
    } catch (e) {
      onToast?.(`Failed: ${e}`, 'err')
    } finally {
      setRunningAgent(false)
    }
  }

  async function retryFailed() {
    const retry = FAILED_RETRY[p.status] ?? (p.status?.includes('FAILED') ? { agent: 'agent1', label: 'Retry' } : null)
    if (!retry) return
    setRetrying(true)
    try {
      const rq = await fetch('/api/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: p.product_id, current_status: p.status }),
      })
      const rqData = await rq.json()
      if (!rq.ok || rqData.error) throw new Error(rqData.error || 'Requeue failed')
      const ar = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: retry.agent, productId: p.product_id }),
      })
      const arData = await ar.json()
      if (!ar.ok || arData.error) throw new Error(arData.error || 'Agent start failed')
      onToast?.(`Retrying ${p.product_id} — agent spawned`, 'ok')
    } catch (e) {
      onToast?.(`Retry failed: ${e}`, 'err')
    } finally {
      setRetrying(false)
    }
  }

  async function doDelete() {
    setDeleting(true)
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: p.product_id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      onClose()
      onDelete?.()
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  // Smart identity consolidation
  const brand = cleanBrand(p.designer_brand || p.extracted_brand) || null
  const name  = p.cms_title || p.final_product_name || p.english_name_draft || null
  const showExtractedNote = p.designer_brand && p.extracted_brand && p.extracted_brand !== p.designer_brand
  const showRawNameNote   = p.cms_title && p.final_product_name && p.final_product_name !== p.cms_title

  return (
    <>
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#0d0d1a] border border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[95vh] overflow-hidden flex flex-col shadow-2xl">

        {/* Header */}
        <div className="px-6 pt-4 pb-4 border-b border-zinc-800 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-500 flex-shrink-0">
                {p.product_id}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold tracking-wide flex-shrink-0 ${sm.color}`}>
                {sm.label}
              </span>
              {p.target_store && (
                <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-500 border border-zinc-700 px-2 py-0.5 rounded-full flex-shrink-0">
                  {p.target_store}
                </span>
              )}
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none flex-shrink-0">✕</button>
          </div>

          {/* Pipeline progress bar */}
          <PipelineProgress status={p.status} />
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          <div className="grid grid-cols-[1fr_320px] min-h-0">

            {/* Left — image */}
            <div className="p-5 border-r border-zinc-800 flex flex-col gap-3">
              {/* Hero — click to open lightbox */}
              <div
                className="w-full aspect-[4/3] bg-zinc-900 rounded-xl overflow-hidden flex items-center justify-center relative group"
                style={{ cursor: galleryImages.length > 0 ? 'zoom-in' : 'default' }}
                onClick={() => { if (galleryImages.length > 0) { setLightboxIdx(galleryImages.findIndex(f => f.url === activeImg || f.url.includes(p.main_image_id ?? '')) || 0); setLightboxOpen(true) } }}
              >
                {activeImg ? (
                  <img src={activeImg} alt="" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-zinc-700 text-4xl">☐</span>
                )}
                {galleryImages.length > 0 && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-semibold bg-black/50 px-2 py-1 rounded-lg">
                      ⤢ View Gallery
                    </span>
                  </div>
                )}
              </div>

              {/* Thumbnail strip */}
              {galleryImages.length > 1 && (
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                  {galleryImages.map((img, idx) => (
                    <div
                      key={img.id}
                      onClick={() => { setActiveImg(img.url); setLightboxIdx(idx) }}
                      style={{
                        width: 52, height: 68, flexShrink: 0,
                        borderRadius: 6, overflow: 'hidden',
                        border: `2px solid ${img.url === activeImg ? 'var(--indigo, #6366f1)' : 'transparent'}`,
                        cursor: 'pointer', opacity: img.url === activeImg ? 1 : 0.65,
                        transition: 'opacity 0.12s, border-color 0.12s',
                        background: '#1a1a2e',
                      }}
                    >
                      <img src={img.url.replace('/w_800,', '/w_120,')} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-4 text-xs text-zinc-500 flex-wrap">
                {p.image_count      && <span>{p.image_count} images</span>}
                {p.webp_image_count && <span>{p.webp_image_count} WebP</span>}
                {p.storage_folder_url && (
                  <a href={p.storage_folder_url} target="_blank" rel="noreferrer"
                    className="text-[#6366f1] hover:underline ml-auto">
                    Folder ↗
                  </a>
                )}
              </div>

              {p.store_url && (
                <a href={p.store_url} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-2 rounded-xl mt-auto
                             bg-emerald-500/10 border border-emerald-500/30 text-emerald-400
                             text-xs font-bold hover:bg-emerald-500/20 transition-colors">
                  View Live on Store ↗
                </a>
              )}
            </div>

            {/* Right — tabbed details */}
            <div className="flex flex-col min-h-0">
              {/* Tab bar */}
              <div className="flex border-b border-zinc-800 px-3 pt-3 gap-0.5 flex-shrink-0 bg-[#0d0d1a]">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-md transition-all border-b-2
                      ${tab === t.key
                        ? 'text-zinc-200 border-[#6366f1]'
                        : 'text-zinc-600 hover:text-zinc-400 border-transparent'
                      }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">

                {/* Identity */}
                {tab === 'identity' && (
                  <>
                    <Field label="Brand" value={brand} />
                    {showExtractedNote && (
                      <p className="text-[10px] text-zinc-600 italic -mt-2">
                        AI initially extracted as &ldquo;{p.extracted_brand}&rdquo;
                      </p>
                    )}
                    <Field label="Name" value={name} />
                    {showRawNameNote && (
                      <p className="text-[10px] text-zinc-600 italic -mt-2">
                        Raw agent name: &ldquo;{p.final_product_name}&rdquo;
                      </p>
                    )}
                    <Field label="Category" value={p.product_type} />
                    <Field label="Price"    value={p.extracted_price ? `¥${p.extracted_price.toLocaleString()}` : null} />
                    <Field label="Material" value={p.material_info} />
                    {p.english_name_draft && !p.final_product_name && (
                      <Field label="Draft Name" value={p.english_name_draft} />
                    )}
                    {p.raw_chinese && (
                      <Field label="Original Chinese" value={p.raw_chinese} mono />
                    )}
                    {p.english_full_translation && (
                      <Field label="Full Translation" value={p.english_full_translation} />
                    )}
                    {!brand && !name && !p.product_type && (
                      <p className="text-zinc-700 text-xs text-center py-8">No identity data yet — run Agent 2.</p>
                    )}
                  </>
                )}

                {/* SEO */}
                {tab === 'seo' && (
                  <>
                    {/* Edit / Save / Cancel header */}
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-500">SEO Content</span>
                      <div className="flex items-center gap-2">
                        {seoSaved && <span className="text-[10px] text-emerald-400">Saved ✓</span>}
                        {!seoEdit ? (
                          <button
                            onClick={() => { setSeoEdit(true); setSeoSaved(false) }}
                            className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-200 transition-colors px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500"
                          >
                            ✎ Edit
                          </button>
                        ) : (
                          <div className="flex gap-1.5">
                            <button
                              onClick={saveSeo}
                              disabled={seoSaving}
                              className="text-[10px] font-semibold px-2.5 py-0.5 rounded border
                                         text-emerald-400 border-emerald-500/40 bg-emerald-500/10
                                         hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                            >
                              {seoSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => { setSeoEdit(false); setSeoError(''); setEditTitle(p.cms_title ?? ''); setEditMeta(p.meta_description ?? ''); setEditDesc(p.product_description ?? ''); setEditBody(p.cms_body_html ?? '') }}
                              className="text-[10px] font-semibold px-2.5 py-0.5 rounded border
                                         text-zinc-500 border-zinc-700 hover:text-zinc-200 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {seoError && <p className="text-[10px] text-red-400">{seoError}</p>}

                    {seoEdit ? (
                      <div className="flex flex-col gap-3">
                        {/* CMS Title */}
                        <div className="flex flex-col gap-0.5">
                          <div className="flex justify-between">
                            <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">SEO Title</span>
                            <span className={`text-[9px] font-semibold ${editTitle.length > 60 ? 'text-red-400' : 'text-zinc-600'}`}>{editTitle.length}/60</span>
                          </div>
                          <textarea
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            rows={2}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none resize-none focus:border-[#6366f1] transition-colors"
                          />
                        </div>
                        {/* Meta Description */}
                        <div className="flex flex-col gap-0.5">
                          <div className="flex justify-between">
                            <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Meta Description</span>
                            <span className={`text-[9px] font-semibold ${editMeta.length > 160 ? 'text-red-400' : 'text-zinc-600'}`}>{editMeta.length}/160</span>
                          </div>
                          <textarea
                            value={editMeta}
                            onChange={e => setEditMeta(e.target.value)}
                            rows={3}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none resize-none focus:border-[#6366f1] transition-colors"
                          />
                        </div>
                        {/* Short Description */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Product Description</span>
                          <textarea
                            value={editDesc}
                            onChange={e => setEditDesc(e.target.value)}
                            rows={3}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none resize-none focus:border-[#6366f1] transition-colors"
                          />
                        </div>
                        {/* Body HTML */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Full Body (HTML)</span>
                          <textarea
                            value={editBody}
                            onChange={e => setEditBody(e.target.value)}
                            rows={6}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[10px] text-zinc-300 outline-none font-mono resize-y focus:border-[#6366f1] transition-colors"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <CharField label="SEO Title"       value={p.cms_title}        max={60}  />
                        <CharField label="Meta Description" value={p.meta_description} max={160} />
                        <Field     label="URL Slug"         value={p.seo_slug}         mono />
                        {p.product_description && (
                          <Field label="Product Description" value={p.product_description} />
                        )}
                        {p.faq_json_ld && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">FAQ Schema</span>
                            <span className="text-xs text-emerald-400">✓ Generated</span>
                          </div>
                        )}
                        {p.product_json_ld && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Product JSON-LD</span>
                            <span className="text-xs text-emerald-400">✓ Generated</span>
                          </div>
                        )}
                        {!p.cms_title && !p.meta_description && !p.seo_slug && (
                          <p className="text-zinc-700 text-xs text-center py-8">No SEO data yet — run Agent 3.</p>
                        )}
                      </>
                    )}
                  </>
                )}

                {/* Research */}
                {tab === 'research' && (
                  <>
                    {score > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Confidence</span>
                          <span className={`text-xs font-bold ${score > 0.6 ? 'text-emerald-400' : score > 0.3 ? 'text-amber-400' : 'text-red-400'}`}>
                            {Math.round(score * 100)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${scoreColor}`} style={{ width: `${Math.round(score * 100)}%` }} />
                        </div>
                      </div>
                    )}
                    {links.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Sources</span>
                        {links.slice(0, 5).map((l, i) => (
                          <a key={i} href={l} target="_blank" rel="noreferrer"
                            className="text-[11px] text-[#6366f1] hover:underline truncate block">
                            {l}
                          </a>
                        ))}
                      </div>
                    )}
                    {p.research_sources && (
                      <Field label="Research Notes" value={p.research_sources} />
                    )}
                    {!score && !links.length && !p.research_sources && (
                      <p className="text-zinc-700 text-xs text-center py-8">No research data yet — run Agent 2.</p>
                    )}
                  </>
                )}

                {/* Media */}
                {tab === 'media' && (
                  <>
                    {(p.image_count || p.webp_image_count) ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Images</span>
                        <span className="text-xs text-zinc-300">
                          {p.image_count ?? 0} original
                          {p.webp_image_count ? ` → ${p.webp_image_count} WebP` : ''}
                        </span>
                      </div>
                    ) : null}
                    {p.viewpoint_labels && Object.keys(p.viewpoint_labels).length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Viewpoints</span>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.keys(p.viewpoint_labels).map(view => (
                            <span key={view} className="px-2 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400">
                              {view}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="border-t border-zinc-800 pt-3 space-y-2">
                      <Field label="Scraped"    value={formatDate(p.scraped_at)    ?? undefined} />
                      <Field label="Researched" value={formatDate(p.researched_at) ?? undefined} />
                      <Field label="Optimised"  value={formatDate(p.optimized_at)  ?? undefined} />
                      <Field label="Published"  value={formatDate(p.published_at)  ?? undefined} />
                    </div>
                    {p.source_url && (
                      <div className="flex flex-col gap-0.5 border-t border-zinc-800 pt-3">
                        <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Source URL</span>
                        <a href={p.source_url} target="_blank" rel="noreferrer"
                          className="text-[11px] text-[#6366f1] hover:underline break-all">
                          {p.source_url}
                        </a>
                      </div>
                    )}
                    {p.notes && (
                      <div className="flex flex-col gap-0.5 border-t border-zinc-800 pt-3">
                        <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-600">Notes</span>
                        <p className="text-xs text-zinc-400 leading-relaxed">{p.notes}</p>
                      </div>
                    )}
                  </>
                )}

              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-zinc-800 flex-shrink-0 flex items-center gap-2">
          {AGENT_TRIGGER[p.status] && (
            <button
              onClick={() => runAgent(AGENT_TRIGGER[p.status].agent)}
              disabled={runningAgent}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                         transition-colors disabled:opacity-40 mr-auto
                         ${AGENT_TRIGGER[p.status].color}`}
            >
              {runningAgent ? 'Starting…' : `▶ ${AGENT_TRIGGER[p.status].label}`}
            </button>
          )}

          {!AGENT_TRIGGER[p.status] && p.status?.includes('FAILED') && (
            <button
              onClick={retryFailed}
              disabled={retrying}
              className="px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                         transition-colors disabled:opacity-40 mr-auto
                         text-red-400 bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
            >
              {retrying ? 'Requeueing…' : `↺ ${FAILED_RETRY[p.status]?.label ?? 'Retry Failed Agent'}`}
            </button>
          )}

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                         text-zinc-500 bg-zinc-800 border-zinc-700
                         hover:text-red-400 hover:border-red-500/30 transition-colors"
            >
              Delete
            </button>
          ) : (
            <>
              <button
                onClick={doDelete}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                           text-red-400 bg-red-500/10 border-red-500/30
                           hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide
                           text-zinc-400 bg-zinc-800 border-zinc-700
                           hover:text-zinc-200 disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>

      </div>
    </div>

    {/* Lightbox */}
    {lightboxOpen && galleryImages.length > 0 && (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.92)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={() => setLightboxOpen(false)}
      >
        {/* Prev */}
        {galleryImages.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); setLightboxIdx(i => { const n = (i - 1 + galleryImages.length) % galleryImages.length; setActiveImg(galleryImages[n].url); return n }) }}
            style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 44, height: 44, fontSize: 22, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >‹</button>
        )}

        {/* Image */}
        <div onClick={e => e.stopPropagation()} style={{ maxWidth: '88vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <img
            src={galleryImages[lightboxIdx]?.url}
            alt={galleryImages[lightboxIdx]?.name}
            style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 48px rgba(0,0,0,0.6)' }}
          />
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'monospace' }}>
            {galleryImages[lightboxIdx]?.name} &nbsp;·&nbsp; {lightboxIdx + 1} / {galleryImages.length}
          </div>
        </div>

        {/* Next */}
        {galleryImages.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); setLightboxIdx(i => { const n = (i + 1) % galleryImages.length; setActiveImg(galleryImages[n].url); return n }) }}
            style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 44, height: 44, fontSize: 22, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >›</button>
        )}

        {/* Close */}
        <button
          onClick={() => setLightboxOpen(false)}
          style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 36, height: 36, fontSize: 18, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >✕</button>
      </div>
    )}
    </>
  )
}
