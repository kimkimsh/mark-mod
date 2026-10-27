export type DashCall = { id: string; tool: string; startedAt: number }

export type DashTurn = { turnId: string; startedAt: number; calls: DashCall[] }

// endsBy: the latest the task can still be running (a monitor's deadline);
// null when only its notification or a Stop snapshot can end it.
export type DashTask = { id: string; kind: string; description: string; startedAt: number; endsBy: number | null }

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

// What an agent runs on, by agent id: the model that answered its latest
// response or, before one, the first its spawn or a request named; and the
// effort its latest request asked for. A teammate in a pane of its own makes
// no request here, so it shows its model alone.
export type DashAgentModel = { model: string; effort: string | null }

export type DashAgentModels = Record<string, DashAgentModel>

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
      agentModels: DashAgentModels
    }
  }
}
