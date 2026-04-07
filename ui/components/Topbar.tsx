'use client'

import { useAddProducts } from '@/context/AddProductsContext'

interface TopbarProps {
  title: string
  onRefresh?: () => void
  refreshing?: boolean
  /** Replaces the default right-side buttons with custom content */
  rightSlot?: React.ReactNode
}

export default function Topbar({ title, onRefresh, refreshing, rightSlot }: TopbarProps) {
  const { open } = useAddProducts()

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      backdropFilter: 'blur(12px)',
      background: 'rgba(244,246,251,0.94)',
      borderBottom: '1px solid var(--border)',
      height: 58,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px',
      flexShrink: 0,
    }}>
      <h1 style={{
        fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700,
        color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.3px',
      }}>
        {title}
      </h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {rightSlot ?? (
          <>
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 8,
                  border: '1px solid var(--border-md)',
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-body)', fontSize: 13,
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'all 130ms ease',
                  opacity: refreshing ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  if (!refreshing) {
                    e.currentTarget.style.color = 'var(--text-primary)'
                    e.currentTarget.style.borderColor = 'var(--teal-glow)'
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--text-secondary)'
                  e.currentTarget.style.borderColor = 'var(--border-md)'
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M13.5 8A5.5 5.5 0 112.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M2.5 2v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Refresh
              </button>
            )}
            <button
              onClick={open}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 18px', borderRadius: 8,
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: '#fff',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
                boxShadow: 'var(--shadow-teal)',
                transition: 'all 130ms ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#0F766E'
                e.currentTarget.style.borderColor = '#0F766E'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--teal)'
                e.currentTarget.style.borderColor = 'var(--teal)'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Add Products
            </button>
          </>
        )}
      </div>
    </header>
  )
}
