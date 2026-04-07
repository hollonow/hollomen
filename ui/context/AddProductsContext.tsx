'use client'

import { createContext, useContext, useState } from 'react'

interface AddProductsContextValue {
  isOpen: boolean
  open:   () => void
  close:  () => void
}

const AddProductsContext = createContext<AddProductsContextValue>({
  isOpen: false,
  open:   () => {},
  close:  () => {},
})

export function AddProductsProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <AddProductsContext.Provider value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}>
      {children}
    </AddProductsContext.Provider>
  )
}

export function useAddProducts() {
  return useContext(AddProductsContext)
}
