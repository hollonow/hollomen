'use client'

import { useState } from 'react'
import { Product } from '@/types'

interface Props {
  product: Product | null
  onClose: () => void
  onRefresh: () => void
}

export default function ReviewModal({ product: p, onClose, onRefresh }: Props) {
  const [name,        setName]        = useState(p?.final_product_name ?? '')
  const [brand,       setBrand]       = useState(p?.designer_brand ?? '')
  const [type,        setType]        = useState(p?.product_type ?? '')
  const [busy,            setBusy]            = useState(false)
  const [error,           setError]           = useState('')
  const [confirmReject,   setConfirmReject]   = useState(false)
  const [expanded,        setExpanded]        = useState(false)
  const [matInfo,     setMatInfo]     = useState(p?.material_info ?? '')
  const [translation, setTranslation] = useState(p?.english_full_translation ?? '')
  const [draftName,   setDraftName]   = useState(p?.english_name_draft ?? '')
  const [resNotes,    setResNotes]    = useState(p?.research_sources ?? '')

  if (!p) return null

  const score      = p.source_reputation_score ?? 0
  const scoreColor = score > 0.6 ? 'bg-emerald-500' : score > 0.3 ? 'bg-amber-500' : 'bg-red-500'
  const links      = Array.isArray(p.research_source_links)
    ? p.research_source_links.slice(0, 5)
    : (p.research_source_links as string | null ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5)
  const imgUrl = p.main_image_id && process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
    ? `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/w_400,c_fill/${p.main_image_id}`
    : null

  async function post(action: 'approve' | 'reject' | 'rerun') {
    setBusy(true)
    setError('')
    try {
      const body: Record<string, string> = {
        product_id:    p!.product_id,
        product_name:  name,
        designer_brand: brand,
        product_type:  type,
        action,
      }
      if (matInfo.trim())     body.material_info            = matInfo.trim()
      if (translation.trim()) body.english_full_translation = translation.trim()
      if (draftName.trim())   body.english_name_draft       = draftName.trim()
      if (resNotes.trim())    body.research_sources         = resNotes.trim()

      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      onClose()
      onRefresh()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-5"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <span className="text-[11px] font-bold tracking-widest uppercase text-amber-400">
            Needs Review
          </span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="p-5 grid grid-cols-[140px_1fr] gap-5">
          {imgUrl && (
            <img
              src={imgUrl}
              alt=""
              className="w-[140px] aspect-[3/4] object-cover rounded-lg bg-zinc-800"
            />
          )}

          <div className="flex flex-col gap-4">
            {/* Editable: Designer Brand */}
            <div>
              <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                Designer Brand — edit if wrong
              </div>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                           text-sm text-zinc-200 outline-none
                           focus:border-[#6366f1] transition-colors"
                value={brand}
                onChange={e => setBrand(e.target.value)}
                placeholder="e.g. Givenchy"
              />
            </div>

            {/* Editable: Product Type */}
            <div>
              <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                Product Type — edit if wrong
              </div>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                           text-sm text-zinc-200 outline-none
                           focus:border-[#6366f1] transition-colors"
                value={type}
                onChange={e => setType(e.target.value)}
                placeholder="e.g. Sneakers"
              />
            </div>

            {/* Source confidence */}
            <div>
              <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                Source Confidence
              </div>
              <div className="text-sm text-zinc-300">{Math.round(score * 100)}%</div>
              <div className="h-1 bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${scoreColor}`}
                  style={{ width: `${Math.round(score * 100)}%` }}
                />
              </div>
            </div>

            {links.length > 0 && (
              <div>
                <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                  Research Sources
                </div>
                <div className="flex flex-col gap-1">
                  {links.map((l, i) => (
                    <a
                      key={i}
                      href={l}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-[#6366f1] hover:underline truncate"
                    >
                      {l}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Editable: Product Name */}
            <div>
              <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                Product Name — edit before approving
              </div>
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                           text-sm text-zinc-200 outline-none resize-none min-h-[56px]
                           focus:border-[#6366f1] transition-colors"
                value={name}
                onChange={e => setName(e.target.value)}
                rows={2}
              />
            </div>

            {/* Collapsible: Manual Research Fields */}
            <div className="border border-zinc-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2
                           text-[9px] font-bold tracking-widest uppercase
                           text-zinc-400 hover:text-zinc-200 transition-colors bg-zinc-800/50"
              >
                <span>Manual Research Fields</span>
                <span className="text-zinc-500">{expanded ? '▲' : '▼'}</span>
              </button>

              {expanded && (
                <div className="p-3 flex flex-col gap-3 bg-zinc-800/20">
                  <p className="text-[10px] text-amber-400/80">
                    Fill these in to manually complete research — Agent 3 will use them directly.
                    Confidence will be set to 100%.
                  </p>

                  <div>
                    <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                      Material Info
                    </div>
                    <textarea
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                                 text-sm text-zinc-200 outline-none resize-none min-h-[56px]
                                 focus:border-[#6366f1] transition-colors"
                      placeholder="e.g. Upper: calf leather, Sole: rubber"
                      rows={2}
                      value={matInfo}
                      onChange={e => setMatInfo(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                      English Translation
                    </div>
                    <textarea
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                                 text-sm text-zinc-200 outline-none resize-none min-h-[56px]
                                 focus:border-[#6366f1] transition-colors"
                      placeholder="Full English translation of the supplier's Chinese text"
                      rows={3}
                      value={translation}
                      onChange={e => setTranslation(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                      Draft Name (Agent 1 extraction)
                    </div>
                    <input
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                                 text-sm text-zinc-200 outline-none
                                 focus:border-[#6366f1] transition-colors"
                      placeholder="e.g. Dior B22 Sneaker Grey"
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mb-1">
                      Research Notes
                    </div>
                    <textarea
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                                 text-sm text-zinc-200 outline-none resize-none min-h-[56px]
                                 focus:border-[#6366f1] transition-colors"
                      placeholder="Any additional research notes for Agent 3"
                      rows={2}
                      value={resNotes}
                      onChange={e => setResNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="text-xs text-red-400">{error}</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-5 pb-5">
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => post('approve')}
              className="flex-1 py-2 rounded-lg text-xs font-bold tracking-wide
                         bg-emerald-500/10 border border-emerald-500/30 text-emerald-400
                         hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              ✓ Approve → Ready for SEO
            </button>
            {confirmReject ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  disabled={busy}
                  onClick={() => post('reject')}
                  className="px-4 py-2 rounded-lg text-xs font-bold tracking-wide
                             bg-red-500/20 border border-red-500/50 text-red-400
                             hover:bg-red-500/30 disabled:opacity-40 transition-colors"
                >
                  ⚠ Confirm Reject
                </button>
                <button
                  onClick={() => setConfirmReject(false)}
                  className="px-4 py-2 rounded-lg text-xs font-bold
                             bg-zinc-800 border border-zinc-700 text-zinc-400
                             hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                disabled={busy}
                onClick={() => setConfirmReject(true)}
                className="px-5 py-2 rounded-lg text-xs font-bold tracking-wide
                           bg-red-500/10 border border-red-500/20 text-red-400
                           hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                ✕ Reject
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => post('rerun')}
              className="flex-1 py-2 rounded-lg text-xs font-bold tracking-wide
                         bg-violet-500/10 border border-violet-500/30 text-violet-400
                         hover:bg-violet-500/20 disabled:opacity-40 transition-colors"
            >
              ↺ Re-run Agent 2 (saves edits above)
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg text-xs font-bold
                         bg-zinc-800 border border-zinc-700 text-zinc-500
                         hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
