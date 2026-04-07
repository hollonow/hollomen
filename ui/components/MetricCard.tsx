'use client'

import { motion, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'

interface MetricCardProps {
  label: string
  sublabel?: string
  count: number
  icon: string
  color: string
  bgColor: string
  borderColor: string
  glowBorder?: boolean
  active?: boolean
  onClick?: () => void
}

function AnimatedCount({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 80, damping: 20 })
  const display = useTransform(spring, (v) => Math.round(v))

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  return <motion.span>{display}</motion.span>
}

const GLOW_COLORS: Record<string, string> = {
  'border-amber-500/30': 'rgba(245,158,11,0.15)',
  'border-emerald-500/30': 'rgba(16,185,129,0.15)',
  'border-red-500/30': 'rgba(239,68,68,0.15)',
  'border-blue-500/30': 'rgba(59,130,246,0.15)',
  'border-violet-500/30': 'rgba(139,92,246,0.15)',
  'border-orange-500/30': 'rgba(249,115,22,0.15)',
  'border-cyan-500/30': 'rgba(6,182,212,0.15)',
}

export default function MetricCard({
  label,
  sublabel,
  count,
  icon,
  color,
  bgColor,
  borderColor,
  glowBorder,
  active,
  onClick,
}: MetricCardProps) {
  const hasValue = count > 0
  const glowShadow = glowBorder && hasValue ? GLOW_COLORS[borderColor] || 'rgba(99,102,241,0.15)' : undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ duration: 0.3 }}
      onClick={onClick}
      className={[
        'relative rounded-2xl border p-5 cursor-pointer transition-all',
        hasValue ? `${bgColor} ${borderColor}` : 'bg-[#0d0d1a] border-zinc-800/60',
        active ? 'ring-2 ring-[#6366f1]/40' : '',
      ].join(' ')}
      style={glowShadow ? { boxShadow: `0 0 20px -4px ${glowShadow}` } : undefined}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className={`text-4xl font-bold ${hasValue ? color : 'text-zinc-600'}`}>
            <AnimatedCount value={count} />
          </div>
          <div className="text-xs text-zinc-500 tracking-widest uppercase mt-1">
            {label}
          </div>
          {sublabel && <p className="text-[10px] text-zinc-500 mt-0.5 tracking-wide">{sublabel}</p>}
        </div>
        <span className="text-xl">{icon}</span>
      </div>
    </motion.div>
  )
}
