export type AgentId = 'cline' | 'agy' | 'opencode' | 'codex'

export type EntryKind = 'text' | 'think' | 'tool' | 'out' | 'error' | 'info'

export type Entry = { kind: EntryKind; text: string }

export type RunMeta = { model: string; tokens: number; cost: number }

export type RunResult = { isOk: boolean; text: string }

export type AgentRun = {
  status: 'idle' | 'running' | 'done' | 'error'
  command: string
  log: string
  startedAt: number
  endedAt: number
  exitCode: number | null
  lines: Entry[]
  result: RunResult | null
  meta: RunMeta
}

export type AgentRuns = Record<AgentId, AgentRun>

export type AgentPolicy = {
  enabled: boolean
  access: 'full' | 'read'
  model: string
  useFor: string
}

export type Policy = {
  when: 'asked' | 'suggest' | 'auto'
  pick: AgentId | 'claude'
  onFail: 'stop' | 'other'
  lifelike: boolean
  agents: Record<AgentId, AgentPolicy>
}

declare module 'claude-code' {
  interface PluginState {
    'agent-dock': { runs: AgentRuns }
  }
}
