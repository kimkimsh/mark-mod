// activity: what the call is doing in plain words, from its own arguments
// ("editing view.tsx"), set once as the call starts.
export type DashCall = { id: string; tool: string; startedAt: number; activity: string }

// The main turn in progress. editedPaths: files an edit changed, by the main
// loop or by an agent this turn started (agentIds, nested ones included,
// teammates and workflow agents aside).
export type DashTurn = {
  turnId: string
  startedAt: number
  calls: DashCall[]
  editedPaths: string[]
  agentIds: string[]
}

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

// What the main turn left behind, gathered while it ran.
export type DashTurnEnd = {
  reason: DashTurnReason
  endedAt: number
  durationMs: number
  editedFiles: number
  subagentsStarted: number
}

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

// What an agent is doing, by agent id: the activity of the tool call its loop
// started last (callId), cleared when that call ends; and the input size of
// its latest response, how full its context is (null before one).
export type DashAgentWork = { activity: string | null; callId: string | null; contextTokens: number | null }

export type DashAgentWorks = Record<string, DashAgentWork>

// $.state outlives a reload, so a value whose form changes must not be read
// back in the old form: give it a new key, or its atom a new `shape` tag
// (AtomOptions); either way the old value reads as absent.
declare module 'claude-code' {
  interface PluginState {
    'mark-mod': {
      mainTurn: DashTurn | null
      openAsks: DashCall[]
      tasks: DashTask[]
      tokens: DashTokens
      hasResponse: boolean
      lastReply: DashTurnEnd | null
      usage: DashUsage | null
      live: DashLive
      agentModels: DashAgentModels
      agentWork: DashAgentWorks
      mainModel: DashAgentModel | null
      compactions: number
      paneClosed: boolean
    }
  }
}
