'use client'

import { motion } from 'framer-motion'
import { useMemo } from 'react'

interface Stage {
  label: string
  count: number
  color: string
  glowColor: string
  borderColor: string
  filter?: string
  isTerminal?: boolean
}

interface PipelineVizProps {
  stats: {
    total: number
    live: number
    pending_approval: number
    needs_review: number
    in_progress: number
    failed: number
  }
  products: Array<{ status: string }>
  onFilterChange?: (filter: string) => void
  agentRunning?: boolean
}

function countByStatuses(products: Array<{ status: string }>, statuses: string[]): number {
  return products.filter((p) => statuses.includes(p.status)).length
}

export default function PipelineViz({ stats, products, onFilterChange, agentRunning }: PipelineVizProps) {
  const stages: Stage[] = useMemo(() => [
    {
      label: 'Queue',
      count: countByStatuses(products, ['READY_FOR_SCRAPE']),
      color: 'text-zinc-400',
      glowColor: 'bg-zinc-500/20',
      borderColor: 'border-zinc-500/40',
      filter: 'READY_FOR_SCRAPE',
    },
    {
      label: 'Mining',
      count: countByStatuses(products, ['READY_FOR_RESEARCH']),
      color: 'text-cyan-400',
      glowColor: 'bg-cyan-500/20',
      borderColor: 'border-cyan-500/40',
      filter: 'READY_FOR_RESEARCH',
    },
    {
      label: 'Research',
      count: countByStatuses(products, ['READY_FOR_SEO']),
      color: 'text-blue-400',
      glowColor: 'bg-blue-500/20',
      borderColor: 'border-blue-500/40',
      filter: 'READY_FOR_SEO',
    },
    {
      label: 'Review',
      count: stats.needs_review,
      color: 'text-amber-400',
      glowColor: 'bg-amber-500/20',
      borderColor: 'border-amber-500/40',
      filter: 'NEEDS_REVIEW',
    },
    {
      label: 'Content',
      count: countByStatuses(products, ['READY_FOR_PUBLISH']),
      color: 'text-violet-400',
      glowColor: 'bg-violet-500/20',
      borderColor: 'border-violet-500/40',
      filter: 'READY_FOR_PUBLISH',
    },
    {
      label: 'Optimize',
      count: countByStatuses(products, ['PUBLISHED']),
      color: 'text-emerald-400',
      glowColor: 'bg-emerald-500/20',
      borderColor: 'border-emerald-500/40',
      filter: 'PUBLISHED',
    },
    {
      label: 'WP Draft',
      count: stats.pending_approval,
      color: 'text-orange-400',
      glowColor: 'bg-orange-500/20',
      borderColor: 'border-orange-500/40',
      filter: 'PENDING_APPROVAL',
      isTerminal: true,
    },
  ], [products, stats])

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {stages.map((stage, index) => {
        const active = stage.count > 0
        return (
          <div key={stage.label} className="flex items-center">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
              onClick={() => stage.filter && onFilterChange?.(stage.filter)}
              className={[
                'rounded-xl px-3 py-2 min-w-[72px] text-center border cursor-pointer transition-colors',
                active ? `${stage.glowColor} ${stage.borderColor}` : 'bg-[#0d0d1a] border-zinc-800/60',
              ].join(' ')}
            >
              <div className={`text-lg font-bold ${active ? stage.color : 'text-zinc-600'}`}>
                {stage.count}
              </div>
              <div className="text-[10px] text-zinc-500 tracking-widest uppercase leading-tight">
                {stage.label}{stage.isTerminal && active ? ' \u2713' : ''}
              </div>
            </motion.div>

            {index < stages.length - 1 && (
              <span
                className={[
                  'text-zinc-700 mx-1 text-xs select-none',
                  agentRunning ? 'animate-pulse' : '',
                ].join(' ')}
              >
                &rarr;
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
