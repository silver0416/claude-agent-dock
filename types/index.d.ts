export type AgentId = 'cline' | 'agy' | 'opencode'

export type AgentRun = {
  status: 'idle' | 'running' | 'done' | 'error'
  command: string
  log: string
  startedAt: number
  endedAt: number
  exitCode: number | null
  lines: string[]
}

export type AgentRuns = Record<AgentId, AgentRun>

declare module 'claude-code' {
  interface PluginState {
    'agent-dock': { runs: AgentRuns }
  }
}
