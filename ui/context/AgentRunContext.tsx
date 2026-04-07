'use client'

import { createContext, useContext, useState } from 'react'

interface AgentRunContextType {
  runningAgent: string | null       // e.g. 'agent1', 'pipeline', or null
  setRunningAgent: (agent: string | null) => void
}

const AgentRunContext = createContext<AgentRunContextType>({
  runningAgent: null,
  setRunningAgent: () => {},
})

export function AgentRunProvider({ children }: { children: React.ReactNode }) {
  const [runningAgent, setRunningAgent] = useState<string | null>(null)
  return (
    <AgentRunContext.Provider value={{ runningAgent, setRunningAgent }}>
      {children}
    </AgentRunContext.Provider>
  )
}

export function useAgentRun() {
  return useContext(AgentRunContext)
}
