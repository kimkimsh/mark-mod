export type DashCall = { id: string; tool: string; startedAt: number }

export type DashTurn = { turnId: string; startedAt: number; calls: DashCall[] }

export type DashTask = { id: string; kind: string; label: string; startedAt: number }

export type DashCounts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type DashTokens = { main: DashCounts; agents: DashCounts }

export type DashTurnReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type DashTurnEnd = { reason: DashTurnReason; endedAt: number; durationMs: number }

export type DashLimit = { kind: string; percentUsed: number; resetsAt: number | null }

export type DashUsage = {
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  limits: DashLimit[]
  costUsd: number | null
}

export type DashAgentStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'

export type DashAgent = {
  id: string
  label: string
  description: string
  status: DashAgentStatus
  isTeammate: boolean
  isNested: boolean
  firstSeenAt: number
}

export type DashLive = { now: number; agents: DashAgent[]; listError: string | null }

declare module 'claude-code' {
  interface PluginState {
    'mark-mod': {
      turn: DashTurn | null
      asks: DashCall[]
      tasks: DashTask[]
      tokens: DashTokens
      hasResponse: boolean
      lastTurn: DashTurnEnd | null
      usage: DashUsage | null
      live: DashLive
    }
  }
}
