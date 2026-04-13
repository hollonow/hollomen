'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import AddProductsModal from './AddProductsModal'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthPage = pathname === '/login' || pathname.startsWith('/auth/') || pathname === '/reset-password'
  if (isAuthPage) return <>{children}</>

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ marginLeft: 224, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {children}
      </main>
      <AddProductsModal />
    </div>
  )
}
