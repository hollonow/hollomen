'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/hooks/useUser'
import Topbar from '@/components/Topbar'

interface UserRow {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'viewer'
  created_at: string
}

type Tab = 'team' | 'integrations' | 'pipeline'

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 42, height: 24, borderRadius: 12,
        background: value ? 'var(--teal)' : 'var(--surface-3)',
        border: `1.5px solid ${value ? 'var(--teal)' : 'var(--border-md)'}`,
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'all 180ms ease',
        boxShadow: value ? '0 0 0 3px var(--teal-glow)' : 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        transition: 'left 180ms ease',
      }} />
    </div>
  )
}

// ── Nav tab ───────────────────────────────────────────────────────────────────
function NavTab({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 14px', borderRadius: 9,
        background: active ? 'var(--teal-dim)' : 'transparent',
        border: 'none',
        borderLeft: `2px solid ${active ? 'var(--teal)' : 'transparent'}`,
        color: active ? 'var(--teal)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-body)', fontSize: 13.5,
        fontWeight: active ? 500 : 400,
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 130ms ease',
      }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
    >
      <span style={{ opacity: active ? 1 : 0.5, flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  )
}

// ── Team Tab ──────────────────────────────────────────────────────────────────
function TeamTab({ isAdmin }: { isAdmin: boolean }) {
  const [users, setUsers]             = useState<UserRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole]   = useState<'admin' | 'viewer'>('viewer')
  const [inviting, setInviting]       = useState(false)
  const [inviteMsg, setInviteMsg]     = useState('')
  const [inviteOk, setInviteOk]       = useState(false)
  const [lastEmail, setLastEmail]     = useState('')
  const [fetchError, setFetchError]   = useState('')
  const [confirmingRemove, setConfirm] = useState<string | null>(null)
  const [usersLoading, setUsersLoading] = useState(true)

  const fetchUsers = async () => {
    const res = await fetch('/api/settings/users')
    if (res.ok) { const d = await res.json(); setUsers(d.users || []) }
    else setFetchError('Failed to load users')
    setUsersLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true); setInviteMsg('')
    const res = await fetch('/api/settings/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    const data = await res.json()
    if (res.ok) {
      setInviteOk(true); setLastEmail(inviteEmail); setInviteEmail(''); fetchUsers()
    } else {
      setInviteOk(false); setInviteMsg(data.error || 'Failed to send invitation.')
    }
    setInviting(false)
  }

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'viewer') => {
    await fetch('/api/settings/role', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole }),
    })
    fetchUsers()
  }

  const handleRemove = async (userId: string) => {
    await fetch('/api/settings/remove', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    setConfirm(null); fetchUsers()
  }

  function initials(u: UserRow) {
    return (u.full_name ?? u.email).slice(0, 2).toUpperCase()
  }

  function avatarColor(email: string) {
    const colors = ['#0D9488','#4F46E5','#D97706','#16A34A','#DC2626','#3858E9']
    return colors[email.charCodeAt(0) % colors.length]
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Invite card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(to right, var(--teal-dim), transparent)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--teal)', flexShrink: 0 }}>
            <path d="M8 8a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 14s-1 0-1-1 1-4 7-4 7 3 7 4-1 1-1 1H2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12.5 3v4M10.5 5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Invite a team member</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Send an invite link to give someone access to HolloEngine</p>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                Email address
              </label>
              <input
                type="email" placeholder="colleague@company.com"
                value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required
                style={{
                  width: '100%', background: 'var(--surface-2)', border: '1.5px solid var(--border-md)',
                  borderRadius: 9, padding: '9px 14px', fontSize: 13.5,
                  color: 'var(--text-primary)', fontFamily: 'var(--font-body)', outline: 'none',
                  transition: 'border-color 150ms', boxSizing: 'border-box',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--teal)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-md)')}
              />
            </div>
            <div style={{ minWidth: 130 }}>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                Role
              </label>
              <select
                value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'viewer')}
                style={{
                  width: '100%', background: 'var(--surface-2)', border: '1.5px solid var(--border-md)',
                  borderRadius: 9, padding: '9px 14px', fontSize: 13.5,
                  color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', outline: 'none',
                }}
              >
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit" disabled={inviting}
              style={{
                padding: '9px 22px', borderRadius: 9, fontSize: 13.5, fontWeight: 500,
                background: 'var(--teal)', border: '1px solid var(--teal)', color: '#fff',
                fontFamily: 'var(--font-body)', cursor: inviting ? 'default' : 'pointer',
                opacity: inviting ? 0.7 : 1, transition: 'all 150ms', whiteSpace: 'nowrap',
                boxShadow: 'var(--shadow-teal)',
              }}
            >
              {inviting ? 'Sending…' : 'Send Invite'}
            </button>
          </form>

          {inviteOk && lastEmail && (
            <div style={{ marginTop: 14, padding: '11px 14px', borderRadius: 9, background: 'var(--success-dim)', border: '1px solid var(--success-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--success)', flexShrink: 0 }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ fontSize: 13, color: 'var(--success)', flex: 1 }}>Invite sent to <strong>{lastEmail}</strong></span>
              <button onClick={() => { setInviteOk(false); setLastEmail('') }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
            </div>
          )}
          {inviteMsg && (
            <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--error)', margin: '10px 0 0' }}>{inviteMsg}</p>
          )}
        </div>
      </div>

      {/* Users list */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)' }}>
              <path d="M2 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H2zM7 9a3 3 0 100-6 3 3 0 000 6zM13.5 5v4M14.5 9h-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Workspace Members</span>
          </div>
          {!usersLoading && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)' }}>
              {users.length} {users.length === 1 ? 'member' : 'members'}
            </span>
          )}
        </div>

        {usersLoading ? (
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-md)', borderTopColor: 'var(--teal)', animation: 'spin 0.7s linear infinite', margin: '0 auto' }} />
          </div>
        ) : fetchError ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--error)', margin: 0 }}>{fetchError}</p>
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: '36px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No team members yet. Invite someone above.</p>
          </div>
        ) : (
          users.map((u, i) => (
            <div
              key={u.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '13px 24px',
                borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none',
                transition: 'background 120ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: avatarColor(u.email),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: '#fff',
              }}>
                {initials(u)}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.full_name ?? u.email}
                </div>
                {u.full_name && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{u.email}</div>
                )}
              </div>

              {/* Role badge */}
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
                padding: '3px 9px', borderRadius: 6, letterSpacing: '0.4px',
                background: u.role === 'admin' ? 'var(--teal-dim)' : 'var(--surface-2)',
                color: u.role === 'admin' ? 'var(--teal)' : 'var(--text-muted)',
                border: `1px solid ${u.role === 'admin' ? 'var(--teal-glow)' : 'var(--border)'}`,
                textTransform: 'uppercase',
              }}>
                {u.role}
              </span>

              {/* Role select */}
              {isAdmin && (
                <select
                  value={u.role}
                  onChange={e => handleRoleChange(u.id, e.target.value as 'admin' | 'viewer')}
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--border-md)',
                    borderRadius: 7, padding: '5px 10px', fontSize: 12,
                    color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
              )}

              {/* Remove */}
              {isAdmin && (
                confirmingRemove === u.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--error)' }}>Remove?</span>
                    <button
                      onClick={() => handleRemove(u.id)}
                      style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'var(--error-dim)', border: '1px solid var(--error-border)', color: 'var(--error)', cursor: 'pointer' }}
                    >Yes</button>
                    <button
                      onClick={() => setConfirm(null)}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirm(u.id)}
                    style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 130ms', flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--error)'; e.currentTarget.style.color = 'var(--error)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    Remove
                  </button>
                )
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Integrations Tab ──────────────────────────────────────────────────────────
const INTEGRATIONS = [
  {
    name: 'Supabase', sub: 'Database & authentication', status: 'connected',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11.5 2L3 13.5h8.5V20L20 8.5H11.5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    color: '#3ECF8E', detail: 'mgnzhngzsachpppvzhuy.supabase.co',
  },
  {
    name: 'Cloudinary', sub: 'Image hosting & CDN', status: 'connected',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M16 15a4 4 0 000-8 4.5 4.5 0 00-8.9 1A3.5 3.5 0 006 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M9 17l2 2 2-2M11 19v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    color: '#3448C5', detail: 'Cloud: dewbp3mcn',
  },
  {
    name: 'OpenAI GPT-4o', sub: 'Vision & copy generation', status: 'connected',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7.5 11c0-1.5 1-3 3.5-3s3.5 1.5 3.5 3-1 3-3.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="11" cy="11" r="1.5" fill="currentColor"/>
      </svg>
    ),
    color: '#10A37F', detail: 'gpt-4o · Vision enabled',
  },
  {
    name: 'SerpAPI', sub: 'Google Lens visual search', status: 'connected',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M15.5 15.5L19 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M8 10h4M10 8v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
    color: '#4285F4', detail: 'Lens API · Tier 1',
  },
  {
    name: 'WooCommerce', sub: 'Product publishing REST API', status: 'connected',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="2" y="5" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 9h18" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M7 13h2M13 13h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
    color: '#7F54B3', detail: 'REST API v3',
  },
  {
    name: 'Yupoo', sub: 'Supplier image source', status: 'connected',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="3" y="3" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="8" cy="8.5" r="1.5" fill="currentColor" opacity="0.6"/>
        <path d="M3 15l4-4 3 3 3-4 4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    color: '#FF6B35', detail: 'Playwright scraper',
  },
]

function IntegrationsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {INTEGRATIONS.map(intg => (
          <div
            key={intg.name}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: '18px 20px',
              display: 'flex', alignItems: 'center', gap: 14,
              boxShadow: 'var(--shadow-xs)', transition: 'all 140ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--border-md)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-xs)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 11, flexShrink: 0,
              background: `${intg.color}12`,
              border: `1.5px solid ${intg.color}28`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: intg.color,
            }}>
              {intg.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{intg.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{intg.sub}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {intg.detail}
              </div>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 0 2px var(--success-dim)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Live</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pipeline Config Tab ───────────────────────────────────────────────────────
function PipelineTab() {
  const [batchSize, setBatchSize]     = useState(20)
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [confidence, setConfidence]   = useState(0.30)
  const [autoApprove, setAutoApprove] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [loaded, setLoaded]           = useState(false)

  useEffect(() => {
    fetch('/api/settings/config')
      .then(r => r.json())
      .then(d => {
        if (typeof d.batch_size === 'number')          setBatchSize(d.batch_size)
        if (typeof d.auto_advance === 'boolean')       setAutoAdvance(d.auto_advance)
        if (typeof d.confidence_threshold === 'number') setConfidence(d.confidence_threshold)
        if (typeof d.auto_approve_reviews === 'boolean') setAutoApprove(d.auto_approve_reviews)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const save = async () => {
    setSaving(true); setSaved(false)
    await fetch('/api/settings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_size: batchSize,
        auto_advance: autoAdvance,
        confidence_threshold: confidence,
        auto_approve_reviews: autoApprove,
      }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (!loaded) return (
    <div style={{ padding: '48px', textAlign: 'center' }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-md)', borderTopColor: 'var(--teal)', animation: 'spin 0.7s linear infinite', margin: '0 auto' }} />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Processing */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--teal)' }}>
            <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Processing</span>
        </div>
        <div style={{ padding: '4px 22px 0' }}>

          {/* Batch size */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500 }}>Batch Size</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Products processed per agent run · applies to all 5 agents</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={1} max={50} step={1} value={batchSize}
                onChange={e => setBatchSize(Number(e.target.value))}
                style={{ width: 120, accentColor: 'var(--teal)', cursor: 'pointer' }}
              />
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
                color: 'var(--teal)', minWidth: 36, textAlign: 'right',
              }}>{batchSize}</div>
            </div>
          </div>

          {/* Auto-advance */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500 }}>Auto-Advance Pipeline</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Start next agent automatically when queue drains</div>
            </div>
            <Toggle value={autoAdvance} onChange={setAutoAdvance} />
          </div>

          {/* Confidence threshold */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500 }}>Confidence Threshold</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                Agent 2 score below this triggers <span style={{ color: 'var(--warning)', fontWeight: 500 }}>NEEDS_REVIEW</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={1} step={0.05} value={confidence}
                onChange={e => setConfidence(Number(e.target.value))}
                style={{ width: 120, accentColor: 'var(--teal)', cursor: 'pointer' }}
              />
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
                color: confidence < 0.5 ? 'var(--warning)' : 'var(--teal)',
                minWidth: 44, textAlign: 'right',
              }}>{confidence.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Review Gate */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--warning)' }}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Review Gate</span>
        </div>
        <div style={{ padding: '4px 22px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500 }}>Auto-Approve Reviews</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Skip NEEDS_REVIEW queue and advance automatically — use with caution</div>
            </div>
            <Toggle value={autoApprove} onChange={setAutoApprove} />
          </div>
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {saved && (
          <span style={{ fontSize: 12.5, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Saved — takes effect on next agent run
          </span>
        )}
        <button
          onClick={save} disabled={saving}
          style={{
            padding: '9px 24px', borderRadius: 9, fontSize: 13.5, fontWeight: 500,
            background: 'var(--teal)', border: '1px solid var(--teal)', color: '#fff',
            fontFamily: 'var(--font-body)', cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1, transition: 'all 150ms',
            boxShadow: 'var(--shadow-teal)',
          }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { isAdmin, loading } = useUser()
  const [tab, setTab] = useState<Tab>('team')

  if (!loading && !isAdmin) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Admin access required.</p>
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'team', label: 'Team',
      icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H2zM7 9a3 3 0 100-6 3 3 0 000 6zM13 6.5a2.5 2.5 0 010 5M15 13.5c0-.8-.6-3-2-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
    {
      key: 'integrations', label: 'Integrations',
      icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zM2 8h12M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M8 2c1.5 2 2.5 3.8 2.5 6s-1 4-2.5 6" stroke="currentColor" strokeWidth="1.4"/></svg>,
    },
    {
      key: 'pipeline', label: 'Pipeline Config',
      icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
    },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <Topbar title="Settings" rightSlot={<span />} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', gap: 28, alignItems: 'flex-start' }}>

          {/* Left nav */}
          <div style={{
            width: 190, flexShrink: 0, position: 'sticky', top: 0,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '8px', boxShadow: 'var(--shadow-xs)',
          }}>
            <div style={{ padding: '10px 10px 8px', marginBottom: 2 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Settings
              </div>
            </div>
            {tabs.map(t => (
              <NavTab key={t.key} icon={t.icon} label={t.label} active={tab === t.key} onClick={() => setTab(t.key)} />
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {tab === 'team'         && <TeamTab isAdmin={isAdmin} />}
            {tab === 'integrations' && <IntegrationsTab />}
            {tab === 'pipeline'     && <PipelineTab />}
          </div>

        </div>
      </div>
    </div>
  )
}
