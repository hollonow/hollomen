'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@/hooks/useUser'
import { useAgentRun } from '@/context/AgentRunContext'

const NAV = [
  {
    label: 'Overview', href: '/', section: 'Pipeline',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/></svg>,
  },
  {
    label: 'Pipeline', href: '/pipeline', section: 'Pipeline',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    badge: true,
  },
  {
    label: 'Automation', href: '/agents', section: 'Pipeline',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  },
  {
    label: 'Reports', href: '/reports', section: 'Pipeline',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 12V5l4-3 4 3v7M6 16v-4h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    label: 'Settings', href: '/settings', section: 'Account',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  },
]

export default function Sidebar() {
  const pathname          = usePathname()
  const { profile, user } = useUser()
  const { runningAgent }  = useAgentRun()

  const displayEmail = profile?.email ?? user?.email ?? null
  const displayRole  = profile?.role ?? null
  const initials     = displayEmail ? displayEmail.slice(0, 2).toUpperCase() : '?'

  let currentSection = ''

  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0,
      width: 224, height: '100vh',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 40,
    }}>
      {/* Logo */}
      <div style={{
        padding: '22px 20px 18px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%',
          background: 'var(--teal)', flexShrink: 0, display: 'inline-block',
          boxShadow: '0 0 0 3px var(--teal-glow)',
        }} />
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.3px',
        }}>
          HolloEngine
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, paddingTop: 10 }}>
        {NAV.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const showSectionLabel = item.section !== currentSection
          if (showSectionLabel) currentSection = item.section

          return (
            <div key={item.href}>
              {showSectionLabel && (
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500,
                  letterSpacing: '1.3px', textTransform: 'uppercase',
                  color: 'var(--text-muted)', padding: '14px 18px 5px', margin: 0,
                }}>
                  {item.section}
                </p>
              )}
              <Link href={item.href} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 18px',
                color: active ? 'var(--teal)' : 'var(--text-secondary)',
                background: active ? 'var(--teal-dim)' : 'transparent',
                borderLeft: `2px solid ${active ? 'var(--teal)' : 'transparent'}`,
                fontFamily: 'var(--font-body)', fontSize: 13.5,
                fontWeight: active ? 500 : 400,
                transition: 'all 130ms ease',
                textDecoration: 'none',
              }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-primary)'
                    e.currentTarget.style.background = 'var(--teal-dim)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-secondary)'
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                <span style={{ width: 15, height: 15, flexShrink: 0, opacity: active ? 1 : 0.5, display: 'flex', alignItems: 'center' }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.label === 'Automation' && runningAgent && (
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: 'var(--success)', flexShrink: 0,
                    animation: 'pulse 1.8s ease-in-out infinite',
                  }} />
                )}
              </Link>
            </div>
          )
        })
        }
      </nav>

      {/* User footer */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--teal-dim)', border: '1.5px solid var(--teal-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
            color: 'var(--teal)', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{
              fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0,
            }}>
              {displayEmail ?? '—'}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize', margin: 0 }}>
              {displayRole ?? 'User'}
            </p>
          </div>
        </div>

        <a
          href="/api/auth/signout"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 12, color: 'var(--text-muted)',
            textDecoration: 'none', transition: 'color 130ms ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Sign out
        </a>
      </div>
    </aside>
  )
}
