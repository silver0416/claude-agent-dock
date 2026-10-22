import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentId, AgentRun, AgentRuns } from '../types'

type Agent = { id: AgentId; label: string; glyph: string }

const AGENTS: Agent[] = [
  { id: 'cline', label: 'Cline', glyph: '◆' },
  { id: 'agy', label: 'agy', glyph: '▲' },
  { id: 'opencode', label: 'OpenCode', glyph: '■' },
]

const IDLE: AgentRun = {
  status: 'idle',
  command: '',
  log: '',
  startedAt: 0,
  endedAt: 0,
  exitCode: null,
  lines: [],
}

const NONE: AgentRuns = { cline: IDLE, agy: IDLE, opencode: IDLE }
const runs = atom({ plugin: 'agent-dock', key: 'runs' } as const, NONE)

const runOf = async ($: EngineInterface, id: AgentId) => (await read($, runs))[id]
const setRun = ($: EngineInterface, id: AgentId, fn: (run: AgentRun) => AgentRun) =>
  update($, runs, all => ({ ...all, [id]: fn(all[id]) }))

// A Bash command that runs one of the CLIs in command position.
const CALL =
  /(?:^|[;&|(\n]\s*|\btimeout\s+(?:-\S+\s+)*\S+\s+)(cline|agy|opencode)(?=\s|$)/
const START = '__AGENT_DOCK_START__'
const EXIT = '__AGENT_DOCK_EXIT__'
const KEEP = 400

const paneId = (id: AgentId) => `agent-dock-${id}`
const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Runs the command as written, copying its output to the log as it comes.
const wrap = (command: string, log: string) =>
  [
    `mkdir -p ${quote(log.replace(/\/[^/]+$/, ''))}`,
    `printf '%s\\n' ${START} > ${quote(log)}`,
    `(\n${command}\n) 2>&1 | tee -a ${quote(log)}`,
    `__dock_rc=\${PIPESTATUS[0]}`,
    `printf '%s %s\\n' ${EXIT} "$__dock_rc" >> ${quote(log)}`,
    `(exit $__dock_rc)`,
  ].join('\n')

// One log line as a person reads it; JSON events of the three CLIs unpacked.
function format(line: string): string[] {
  const text = line.trimEnd()
  if (text.trim() === '') return []
  if (!text.trimStart().startsWith('{')) return [text]

  let o: any
  try {
    o = JSON.parse(text)
  } catch {
    return [text]
  }

  const say = (s: unknown) => String(s).split('\n')
  const think = (s: unknown) => say(s).map(row => `💭 ${row}`)
  const brief = (input: unknown) => {
    const s = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    return s.length > 160 ? `${s.slice(0, 160)}…` : s
  }
  const result = (status: unknown, seconds: unknown, response: unknown) => [
    `── ${status ?? 'result'} ${Math.round(Number(seconds) || 0)}s ──`,
    ...say(response),
  ]

  // OpenCode: one event per part.
  const part = o.part ?? {}
  if (part.type === 'reasoning') return think(part.text)
  if (part.type === 'text' && typeof part.text === 'string') return say(part.text)
  if (part.type === 'tool') {
    return [`⚙ ${part.tool} ${brief(part.state?.input)} → ${part.state?.status ?? ''}`]
  }
  if (/step[-_](start|finish)/.test(String(o.type))) return []

  // agy (stream-json, or the one json result).
  if (o.event === 'init') return ['▶ started']
  if (o.event === 'step_update') {
    const step = o.step_update ?? {}
    if (step.step_type === 'tool' && step.state === 'ACTIVE') {
      return [`⚙ ${step.tool_name} ${brief(step.tool_info?.parameters)}`]
    }
    if (typeof step.text === 'string') return say(step.text)
    return []
  }
  if (o.event === 'result') {
    const r = o.result ?? {}
    return result(r.status, r.duration_seconds, r.response)
  }
  if (typeof o.response === 'string') return result(o.status, o.duration_seconds, o.response)

  // Cline: streamed pieces are skipped, each block shown whole at its end.
  if (o.type === 'agent_event') {
    const ev = o.event ?? {}
    if (ev.type === 'content_end' && ev.contentType === 'text') return say(ev.text)
    if (ev.type === 'content_end' && ev.contentType === 'reasoning') return think(ev.reasoning)
    if (ev.type === 'content_start' && ev.contentType === 'tool') {
      return [`⚙ ${ev.toolName} ${brief(ev.input)}`]
    }
    return []
  }
  if (o.type === 'run_result') {
    return result(o.finishReason, (o.durationMs ?? 0) / 1000, o.text)
  }
  if (o.type === 'hook_event') return []

  if (typeof o.text === 'string' && o.text !== '') return say(o.text)
  if (typeof o.message === 'string') return say(o.message)
  if (typeof o.message?.content === 'string') return say(o.message.content)
  return [`· ${o.type ?? o.event ?? 'event'}`]
}

// Cells a string takes: wide East Asian characters take two.
const cells = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff)
    ? 2
    : 1
}

function fold(line: string, columns: number): string[] {
  const out: string[] = []
  let row = ''
  let width = 0
  for (const ch of line) {
    const w = cells(ch)
    if (width + w > columns) {
      out.push(row)
      row = ''
      width = 0
    }
    row += ch
    width += w
  }
  out.push(row)
  return out
}

const seconds = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function badge(run: AgentRun, now: number): { text: string; color: string } {
  switch (run.status) {
    case 'running':
      return { text: `● ${seconds(now - run.startedAt)}`, color: 'warning' }
    case 'done':
      return { text: '✓', color: 'success' }
    case 'error':
      return { text: `✗${run.exitCode === null ? '' : ` ${run.exitCode}`}`, color: 'error' }
    default:
      return { text: '○', color: 'inactive' }
  }
}

async function logPath($: EngineInterface, id: AgentId) {
  const home = (await $.env.get('HOME')) ?? '/tmp'
  return `${home}/.claude/agent-dock/${id}.log`
}

// Reads the run's log into its state; the exit line ends the run.
async function poll($: EngineInterface, id: AgentId) {
  const run = await runOf($, id)
  if (run.status !== 'running' || run.log === '') return

  const { exitCode, stdout } = await $.process.run(['tail', '-n', String(KEEP), run.log])
  if (exitCode !== 0) return

  let ended: number | null = null
  const lines: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.startsWith(START)) continue
    if (line.startsWith(EXIT)) {
      ended = Number(line.slice(EXIT.length).trim())
      continue
    }
    lines.push(...format(line))
  }
  const now = await $.clock.now()

  await setRun($, id, current => {
    if (current.startedAt !== run.startedAt) return current
    const next = { ...current, lines: lines.slice(-KEEP) }
    if (ended === null) return next
    return { ...next, status: ended === 0 ? 'done' : 'error', exitCode: ended, endedAt: now }
  })
  if (ended !== null) {
    const agent = AGENTS.find(a => a.id === id)
    $.ui.toast(`${agent?.label ?? id} finished ${ended === 0 ? '✓' : `✗ ${ended}`}`)
  }
}

// How the model hands work to the CLIs, so "let opencode do X" just works.
// The person chose full auto: the CLIs approve their own tools.
const GUIDE = `# Agent dock: delegating to other coding-agent CLIs

The person may ask you to hand work to another coding-agent CLI on this machine: Cline (\`cline\`), agy (the Antigravity CLI, \`agy\`) or OpenCode (\`opencode\`). The person has chosen full auto for these runs: each CLI edits files and runs commands without asking.

Dispatch it yourself with the Bash tool and \`run_in_background: true\`, so you can keep working; you are notified when it exits, then read its output file and carry on with whatever comes next. The person watches each run live in the agent tabs (log: ~/.claude/agent-dock/<cli>.log), so do not pipe the command into tail or head. One run per CLI at a time.

- OpenCode: \`opencode run --format json --auto "<task>" < /dev/null\` (\`-m provider/model\` if asked; continue: \`-s <sessionID>\`). Its answer is the \`part.text\` of the "text" events.
- Cline: \`cline --json -c <dir> -t 1800 "<task>" < /dev/null\` (continue: \`--id <session>\`). Its answer is the \`text\` of the "run_result" line.
- agy: \`agy --output-format stream-json --dangerously-skip-permissions --print-timeout 1800s -p "<task>" < /dev/null\`, with \`-p "<task>"\` last (continue: \`--conversation <conversation_id>\`). Its answer is the \`response\` of the "result" event.

For a question that needs no changes, use the read-only form instead: OpenCode \`--agent plan\` in place of \`--auto\`, Cline \`-p\`, agy \`--mode plan\` without the skip flag.

The other agent cannot see this conversation: write the task with full context (absolute paths, the goal, how to check it is done). It works in the directory you start it in, so start it in the project the task is about. When it has edited files, review what it changed (git diff, a test run) before you report the work as done.`

const KEY = 'ctrl+x d'

const openPanes = async ($: EngineInterface) => {
  for (const agent of AGENTS) {
    await $.ui.open({ id: paneId(agent.id), title: `${agent.glyph} ${agent.label}` })
  }
}

const isDockOpen = async ($: EngineInterface) =>
  (await $.ui.panes()).some(pane => pane.id.startsWith('agent-dock-'))

// The one switch: all three tabs come and go together.
async function toggleDock($: EngineInterface) {
  if (await isDockOpen($)) {
    for (const agent of AGENTS) await $.ui.close({ id: paneId(agent.id) })
  } else {
    await openPanes($)
  }
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The pane of the earlier single-pane layout.
    await $.ui.close({ id: 'agent-dock' })
    $.ui.status(`agents: ${KEY}`)
    $.clock.every(1000, () => {
      void (async () => {
        let isRunning = false
        for (const agent of AGENTS) {
          if ((await runOf($, agent.id)).status !== 'running') continue
          isRunning = true
          await poll($, agent.id)
        }
        if (isRunning) $.ui.invalidate('ui.render')
      })()
    })
    await $.command.register({
      name: 'agent-dock',
      description: `Show or hide the coding-agent CLI tabs (Cline, agy, OpenCode); ${KEY}`,
      immediate: true,
    })
    return started
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'agent-dock:guide', text: GUIDE, scope: 'session' }],
    }
  })

  on('command.run', { command: 'agent-dock' }, async $ => {
    await toggleDock($)
    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id.startsWith('agent-dock-')) $.ui.invalidate('ui.render')
    return closed
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const found = CALL.exec(e.command)
    if (found === null || e.command.includes(EXIT)) return next(e)

    const id = found[1] as AgentId
    const log = await logPath($, id)
    const startedAt = await $.clock.now()
    await setRun($, id, () => ({
      ...IDLE,
      status: 'running',
      command: e.command,
      log,
      startedAt,
    }))

    const ran = await next({ ...e, command: wrap(e.command, log) })
    await poll($, id)

    // A foreground run that never wrote its exit line was stopped from outside.
    if (ran.deny !== undefined || e.run_in_background !== true) {
      const now = await $.clock.now()
      await setRun($, id, current =>
        current.startedAt === startedAt && current.status === 'running'
          ? { ...current, status: 'error', endedAt: now }
          : current,
      )
    }
    return ran
  })

  // One small button at the right: each agent's mark, then show or hide.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const all = await read($, runs)
    const isOpen = await isDockOpen($)

    return (
      <Box flexDirection="row" justifyContent="flex-end">
        <Button key="toggle" plain onPress={() => toggleDock($)}>
          {AGENTS.map(agent => {
            const mark = badge(all[agent.id], now)
            return (
              <Text color={mark.color}>
                {agent.glyph}
                {mark.text.slice(0, 1)}{' '}
              </Text>
            )
          })}
          <Text dimColor>{isOpen ? '⇥ hide' : '⇤ agents'} ({KEY})</Text>
        </Button>
      </Box>
    )
  })

  // One tab per agent, all three kept open together.
  for (const agent of AGENTS) {
    on('ui.render', { component: 'Pane', requestId: paneId(agent.id) }, async ($, e) => {
      const { Box, Button, Text } = $.ui.resolve(e)
      const run = (await read($, runs))[agent.id]
      const now = await $.clock.now()
      const mark = badge(run, now)
      const columns = Math.max(20, e.props.bodyColumns)
      const room = Math.max(3, e.props.scroll.bodyRows - 3)
      const end = run.status === 'running' ? now : run.endedAt
      const rows = run.lines.flatMap(line => fold(line, columns)).slice(-room)

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text color={mark.color}>{mark.text}</Text>
              <Text dimColor>
                {run.status === 'idle' ? ' idle' : `  ${run.status} ${seconds(end - run.startedAt)}`}
              </Text>
            </Text>
            <Box flexDirection="row" gap={1}>
              {run.status !== 'idle' && run.status !== 'running' && (
                <Button key="clear" plain dimColor label="clear"
                  onPress={() => setRun($, agent.id, () => IDLE)} />
              )}
              <Text dimColor>{KEY} hides</Text>
            </Box>
          </Box>
          {run.command !== '' && (
            <Text dimColor wrap="truncate-end">
              $ {run.command.replace(/\s+/g, ' ')}
            </Text>
          )}
          {rows.length === 0 ? (
            <Text dimColor>
              {run.status === 'running' ? 'waiting for output…' : run.status === 'idle' ? 'no run yet' : 'no output'}
            </Text>
          ) : (
            rows.map(row => <Text wrap="truncate-end">{row}</Text>)
          )}
        </Box>
      )
    })
  }
}
