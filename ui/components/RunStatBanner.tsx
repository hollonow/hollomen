'use client'

import { motion, AnimatePresence } from 'framer-motion'

interface RunStatBannerProps {
  stat: {
    count: number
    durationMs: number
    laborSavedMs: number
  } | null
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function RunStatBanner({ stat }: RunStatBannerProps) {
  return (
    <AnimatePresence>
      {stat && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-zinc-800/60 bg-[#0d0d1a] backdrop-blur-sm"
        >
          <div className="grid grid-cols-3 divide-x divide-zinc-800/40">
            {/* Products */}
            <div className="px-6 py-4 text-center">
              <div className="text-2xl mb-1">
                <span role="img" aria-label="products">&#x1F45F;</span>
              </div>
              <div className="text-3xl font-bold text-zinc-100">{stat.count}</div>
              <div className="text-xs text-zinc-500 tracking-widest uppercase mt-1">
                Products (last run)
              </div>
            </div>

            {/* Duration */}
            <div className="px-6 py-4 text-center">
              <div className="text-2xl mb-1">
                <span role="img" aria-label="duration">&#x23F1;&#xFE0F;</span>
              </div>
              <div className="text-3xl font-bold text-zinc-100">{fmtDuration(stat.durationMs)}</div>
              <div className="text-xs text-zinc-500 tracking-widest uppercase mt-1">
                Avg. per Product
              </div>
            </div>

            {/* Labor Saved */}
            <div className="px-6 py-4 text-center">
              <div className="text-2xl mb-1">
                <span role="img" aria-label="labor saved">&#x1F4AA;</span>
              </div>
              <div className="text-3xl font-bold text-zinc-100">{fmtDuration(stat.laborSavedMs)}</div>
              <div className="text-xs text-zinc-500 tracking-widest uppercase mt-1">
                Human Labor Saved
              </div>
              <div className="text-[10px] text-zinc-600 mt-0.5">
                @ 18 min/product vs manual
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
