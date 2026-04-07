interface StatCardProps {
  label:   string
  value:   string
  sub?:    string
  variant: 'gold' | 'accent' | 'success' | 'neutral'
}

const TOP_BAR: Record<StatCardProps['variant'], string> = {
  gold:    'var(--gold)',
  accent:  'var(--accent)',
  success: 'var(--success)',
  neutral: 'var(--text-muted)',
}
const VALUE_COLOR: Record<StatCardProps['variant'], string> = {
  gold:    'var(--gold)',
  accent:  'var(--text-primary)',
  success: 'var(--success)',
  neutral: 'var(--text-primary)',
}

export default function StatCard({ label, value, sub, variant }: StatCardProps) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '22px 24px',
      borderTop: `2px solid ${TOP_BAR[variant]}`,
    }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 10px' }}>
        {label}
      </p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, lineHeight: 1, letterSpacing: '-1px', color: VALUE_COLOR[variant], margin: 0 }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>{sub}</p>
      )}
    </div>
  )
}
