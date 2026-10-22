import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentId, AgentRun, AgentRuns, Entry, RunMeta, RunResult } from '../types'

type Agent = { id: AgentId; label: string; glyph: string }

const AGENTS: Agent[] = [
  { id: 'cline', label: 'Cline', glyph: '◆' },
  { id: 'agy', label: 'agy', glyph: '▲' },
  { id: 'opencode', label: 'OpenCode', glyph: '■' },
]

const NO_META: RunMeta = { model: '', tokens: 0, cost: 0 }

const IDLE: AgentRun = {
  status: 'idle',
  command: '',
  log: '',
  startedAt: 0,
  endedAt: 0,
  exitCode: null,
  lines: [],
  result: null,
  meta: NO_META,
}

const NONE: AgentRuns = { cline: IDLE, agy: IDLE, opencode: IDLE }
const runs = atom({ plugin: 'agent-dock', key: 'runs' } as const, NONE)

// A run kept by an earlier version of the mod holds plain string lines.
const settle = (run: AgentRun): AgentRun => ({
  ...IDLE,
  ...run,
  lines: run.lines.map(line =>
    typeof line === 'string' ? { kind: 'text', text: line } : line,
  ),
})

const runOf = async ($: EngineInterface, id: AgentId) => settle((await read($, runs))[id])
const setRun = ($: EngineInterface, id: AgentId, fn: (run: AgentRun) => AgentRun) =>
  update($, runs, all => ({ ...all, [id]: fn(settle(all[id])) }))

// A Bash command that runs one of the CLIs in command position.
const CALL =
  /(?:^|[;&|(\n]\s*|\btimeout\s+(?:-\S+\s+)*\S+\s+)(cline|agy|opencode)(?=\s|$)/
// Asking a CLI for its help or version is not a run.
const HELP = /\b(?:cline|agy|opencode)\s+(?:\S+\s+)?(?:--help|-h|--version|-v)\b/
const START = '__AGENT_DOCK_START__'
const EXIT = '__AGENT_DOCK_EXIT__'
const READ = 3000
const KEEP = 400

// Runs read once more after finishing empty, so each is read only once.
const reread = new Set<string>()
// The last polling error shown, so a lasting one is shown once.
let lastError = ''

const paneId = (id: AgentId) => `agent-dock-${id}`
const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Runs the command as written, copying its output to the log as it comes.
const wrap = (command: string, log: string) =>
  [
    `mkdir -p ${quote(log.replace(/\/[^/]+$/, ''))}`,
    `rm -f ${quote(`${log}.rc`)}`,
    `printf '%s\\n' ${START} > ${quote(log)}`,
    `{ (\n${command}\n) 2>&1; echo $? > ${quote(`${log}.rc`)}; } | tee -a ${quote(log)}`,
    `__dock_rc=$(cat ${quote(`${log}.rc`)} 2>/dev/null || echo 1)`,
    `printf '%s %s\\n' ${EXIT} "$__dock_rc" >> ${quote(log)}`,
    `(exit $__dock_rc)`,
  ].join('\n')

// The task as the command spells it: its longest quoted string.
function taskOf(command: string): string {
  let best = ''
  for (const m of command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    const s = (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1')
    if (s.length > best.length) best = s
  }
  return best.replace(/\s+/g, ' ').trim()
}

// The model the command names, if it names one.
const modelOf = (command: string) =>
  /(?:^|\s)(?:-m|--model)[=\s]+["']?([^\s"']+)/.exec(command)?.[1] ?? ''

type Parsed = {
  entries: Entry[]
  result?: RunResult
  meta?: Partial<RunMeta>
  tokens?: number
  cost?: number
}

const firstLine = (s: unknown) => {
  const line = String(s ?? '').split('\n').find(row => row.trim() !== '') ?? ''
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

const brief = (input: unknown) => {
  if (input === undefined || input === null) return ''
  if (typeof input === 'string') return firstLine(input)
  const values = Object.values(input as Record<string, unknown>)
  const s = values.length === 1 && typeof values[0] === 'string'
    ? values[0]
    : JSON.stringify(input)
  return firstLine(s)
}

const many = (kind: Entry['kind'], s: unknown): Entry[] =>
  String(s ?? '')
    .split('\n')
    .map(text => ({ kind, text }))

// One log line as the pane shows it; the JSON events of the three CLIs unpacked.
function parse(line: string): Parsed {
  const text = line.trimEnd()
  if (text.trim() === '') return { entries: [] }
  if (!text.trimStart().startsWith('{')) {
    const kind = /\b(error|failed|exception)\b/i.test(text) ? 'error' : 'text'
    return { entries: [{ kind, text }] }
  }

  let o: any
  try {
    o = JSON.parse(text)
  } catch {
    return { entries: [{ kind: 'text', text }] }
  }

  // OpenCode: one event per part.
  const part = o.part ?? {}
  if (part.type === 'reasoning') return { entries: many('think', part.text) }
  if (part.type === 'text' && typeof part.text === 'string') return { entries: many('text', part.text) }
  if (part.type === 'tool') {
    const state = part.state ?? {}
    const mark = state.status === 'completed' ? ' ✓' : state.status === 'error' ? ' ✗' : ''
    const entries: Entry[] = [{ kind: 'tool', text: `${part.tool}${mark}  ${brief(state.input)}` }]
    if (state.status === 'error') entries.push({ kind: 'error', text: firstLine(state.error ?? state.output) })
    else if (state.output !== undefined) entries.push({ kind: 'out', text: firstLine(state.output) })
    return { entries }
  }
  if (part.type === 'step-finish') {
    const t = part.tokens ?? {}
    return { entries: [], tokens: (t.input ?? 0) + (t.output ?? 0), cost: part.cost ?? 0 }
  }
  if (/step[-_]start/.test(String(o.type))) return { entries: [] }

  // agy (stream-json, or the one json result).
  if (o.event === 'init') return { entries: [{ kind: 'info', text: 'started' }] }
  if (o.event === 'step_update') {
    const step = o.step_update ?? {}
    if (step.step_type === 'tool' && step.state === 'ACTIVE') {
      return { entries: [{ kind: 'tool', text: `${step.tool_name}  ${brief(step.tool_info?.parameters)}` }] }
    }
    if (step.step_type === 'tool' && step.state === 'DONE' && step.tool_info?.output !== undefined) {
      return { entries: [{ kind: 'out', text: firstLine(step.tool_info.output) }] }
    }
    if (typeof step.text === 'string') return { entries: many('text', step.text) }
    return { entries: [] }
  }
  const agyResult = o.event === 'result' ? o.result ?? {} : typeof o.response === 'string' ? o : null
  if (agyResult !== null) {
    return {
      entries: [],
      result: {
        isOk: agyResult.status === 'SUCCESS',
        text: String(agyResult.response || agyResult.error || ''),
      },
      meta: { tokens: agyResult.usage?.total_tokens ?? 0 },
    }
  }

  // Cline: streamed pieces are skipped, each block shown whole at its end.
  if (o.type === 'agent_event') {
    const ev = o.event ?? {}
    if (ev.type === 'content_end' && ev.contentType === 'text') return { entries: many('text', ev.text) }
    if (ev.type === 'content_end' && ev.contentType === 'reasoning') return { entries: many('think', ev.reasoning) }
    if (ev.type === 'content_start' && ev.contentType === 'tool') {
      return { entries: [{ kind: 'tool', text: `${ev.toolName}  ${brief(ev.input)}` }] }
    }
    if (ev.type === 'content_end' && ev.contentType === 'tool') {
      const out = Array.isArray(ev.output) ? ev.output.map((x: any) => x?.result ?? x).join('\n') : ev.output
      return { entries: [{ kind: 'out', text: firstLine(typeof out === 'string' ? out : JSON.stringify(out)) }] }
    }
    return { entries: [] }
  }
  if (o.type === 'run_result') {
    const usage = o.usage ?? {}
    return {
      entries: [],
      result: { isOk: o.finishReason === 'completed', text: String(o.text ?? '') },
      meta: {
        model: o.model?.info?.name ?? o.model?.id ?? '',
        tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        cost: usage.totalCost ?? 0,
      },
    }
  }
  if (o.type === 'hook_event') return { entries: [] }

  // Cline's own hook plumbing complains on every run; not the run's error.
  if (o.type === 'error' && /^hook dispatch failed/.test(String(o.message))) return { entries: [] }
  if (o.type === 'error' && typeof o.message === 'string') return { entries: many('error', o.message) }
  if (typeof o.error === 'string') return { entries: many('error', o.error) }
  if (typeof o.error?.message === 'string') return { entries: many('error', o.error.message) }
  if (typeof o.text === 'string' && o.text !== '') return { entries: many('text', o.text) }
  if (typeof o.message === 'string') return { entries: many('text', o.message) }
  return { entries: [{ kind: 'info', text: String(o.type ?? o.event ?? 'event') }] }
}

// Cells a character takes: wide East Asian characters take two.
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

const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function badge(run: AgentRun, now: number): { mark: string; word: string; color: string } {
  switch (run.status) {
    case 'running':
      return { mark: '●', word: `running ${seconds(now - run.startedAt)}`, color: 'warning' }
    case 'done':
      return { mark: '✓', word: `done ${seconds(run.endedAt - run.startedAt)}`, color: 'success' }
    case 'error':
      return {
        mark: '✗',
        word: `failed${run.exitCode === null ? '' : ` (exit ${run.exitCode})`} ${seconds(run.endedAt - run.startedAt)}`,
        color: 'error',
      }
    default:
      return { mark: '○', word: 'idle', color: 'inactive' }
  }
}

async function logPath($: EngineInterface, id: AgentId) {
  // Windows: C:/Users/<name>, a path both the engine and Git Bash read.
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '/tmp').replaceAll('\\', '/')
  return `${home}/.claude/agent-dock/${id}.log`
}

// The log's last lines, read by the engine itself (Windows has no tail); a log
// too big for one read falls back to tail, then to the exit code alone.
async function readLog($: EngineInterface, log: string): Promise<string | null> {
  try {
    return (await $.fs.read(log)).split('\n').slice(-READ).join('\n')
  } catch {}
  try {
    const { exitCode, stdout } = await $.process.run(['tail', '-n', String(READ), log])
    if (exitCode === 0) return stdout
  } catch {}
  try {
    const rc = (await $.fs.read(`${log}.rc`)).trim()
    return `log too large to show\n${EXIT} ${rc === '' ? 1 : rc}`
  } catch {}
  return null
}

// Terminal colours and other control characters, which a drawing refuses.
const clean = (s: string) =>
  s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replaceAll('\t', '  ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

// Reads the run's log into its state; the exit line ends the run. `again`
// reads a finished run's log once more, for a run whose reads came up empty.
async function poll($: EngineInterface, id: AgentId, again = false) {
  const run = await runOf($, id)
  if ((run.status !== 'running' && !again) || run.log === '') return

  const stdout = await readLog($, run.log)
  if (stdout === null) return

  let ended: number | null = null
  let result: RunResult | null = null
  let tokens = 0
  let cost = 0
  const meta: RunMeta = { ...NO_META, model: modelOf(run.command) }
  const lines: Entry[] = []
  for (const line of stdout.split('\n')) {
    if (line.startsWith(START)) continue
    if (line.startsWith(EXIT)) {
      ended = Number(line.slice(EXIT.length).trim())
      continue
    }
    const parsed = parse(clean(line))
    lines.push(...parsed.entries.map(entry => ({ ...entry, text: clean(entry.text) })))
    tokens += parsed.tokens ?? 0
    cost += parsed.cost ?? 0
    if (parsed.result !== undefined) result = { ...parsed.result, text: clean(parsed.result.text) }
    if (parsed.meta !== undefined) Object.assign(meta, Object.fromEntries(
      Object.entries(parsed.meta).filter(([, v]) => v !== '' && v !== 0),
    ))
  }
  if (meta.tokens === 0) meta.tokens = tokens
  if (meta.cost === 0) meta.cost = cost

  // The last block of text is the answer: kept once, in the answer box. A CLI
  // with no result event (OpenCode) has only that block to give.
  let from = lines.length
  while (from > 0 && lines[from - 1]?.kind === 'text') from -= 1
  const tail = lines.slice(from).map(entry => entry.text).join('\n').trim()
  if (result !== null && tail !== '' && tail === result.text.trim()) lines.splice(from)
  if (ended !== null && result === null && tail !== '') {
    result = { isOk: ended === 0, text: tail }
    lines.splice(from)
  }
  const now = await $.clock.now()

  await setRun($, id, current => {
    if (current.startedAt !== run.startedAt) return current
    const next = { ...current, lines: lines.slice(-KEEP), result, meta }
    if (ended === null) return next
    return { ...next, status: ended === 0 ? 'done' : 'error', exitCode: ended, endedAt: now }
  })
  if (ended !== null && run.status === 'running') {
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
- Cline: \`cline --json -c <dir> -t 1800 "<task>" < /dev/null\` (continue: \`--id <session>\`). Its answer is the \`text\` of the "run_result" line. Cline treats a prompt with no spaces as a subcommand name and exits, so a task written without spaces (e.g. all Chinese) needs a space or an English lead-in.
- agy: \`agy --output-format stream-json --dangerously-skip-permissions --print-timeout 1800s -p "<task>" < /dev/null\`, with \`-p "<task>"\` last (continue: \`--conversation <conversation_id>\`). Its answer is the \`response\` of the "result" event.

For a question that needs no changes, use the read-only form instead: OpenCode \`--agent plan\` in place of \`--auto\`, Cline \`-p\`, agy \`--mode plan\` without the skip flag.

The other agent cannot see this conversation: write the task with full context (absolute paths, the goal, how to check it is done). It works in the directory you start it in, so start it in the project the task is about. When it has edited files, review what it changed (git diff, a test run) before you report the work as done.

When a run fails (non-zero exit, an error event, "model unavailable", an auth or quota error), report the error to the person in one short message and stop: do not retry it, re-dispatch it, switch it to another CLI or model, or start another run unless the person asks. A notification about a run that already ended needs no new dispatch. When the error is about the model (unavailable, no longer free, unauthorized, out of credit), say which CLI and model failed and that the person picks another one in that CLI's own settings (Cline: \`cline auth\`; OpenCode: \`model\` in ~/.config/opencode/opencode.jsonc; agy: \`agy models\`).`

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

const PREFIX: Record<Entry['kind'], string> = {
  text: '',
  think: '┊ ',
  tool: '⚙ ',
  out: '  ↳ ',
  error: '✗ ',
  info: '· ',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The pane of the earlier single-pane layout.
    await $.ui.close({ id: 'agent-dock' })
    // The status line entry of earlier versions; the hint now sits in the footer.
    $.ui.status(undefined)
    $.clock.every(1000, () => {
      void (async () => {
        let isRunning = false
        for (const agent of AGENTS) {
          if ((await runOf($, agent.id)).status !== 'running') continue
          isRunning = true
          await poll($, agent.id)
        }
        if (isRunning) $.ui.invalidate('ui.render')
      })().catch(err => {
        if (String(err) === lastError) return
        lastError = String(err)
        $.ui.toast(`agent-dock: ${lastError}`)
      })
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
    if (found === null || e.command.includes(EXIT) || HELP.test(e.command)) return next(e)

    const id = found[1] as AgentId
    const log = await logPath($, id)
    const startedAt = await $.clock.now()
    await setRun($, id, () => ({
      ...IDLE,
      status: 'running',
      command: e.command,
      log,
      startedAt,
      meta: { ...NO_META, model: modelOf(e.command) },
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

  // The key, among the dim mode labels at the right of the prompt footer.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) =>
    next({ ...e, props: { ...e.props, modes: [...e.props.modes, `agents: ${KEY}`] } }),
  )

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
            const b = badge(settle(all[agent.id]), now)
            return (
              <Text color={b.color}>
                {agent.glyph}
                {b.mark}{' '}
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
      const { Box, Button, Text, Markdown } = $.ui.resolve(e)
      const run = settle((await read($, runs))[agent.id])
      // A finished run with nothing read: read its log once more.
      const mark = `${agent.id}:${run.startedAt}`
      if (run.status !== 'running' && run.log !== '' && run.lines.length === 0 &&
        run.result === null && !reread.has(mark)) {
        reread.add(mark)
        void poll($, agent.id, true).then(() => $.ui.invalidate('ui.render'))
      }
      const now = await $.clock.now()
      const b = badge(run, now)
      const columns = Math.max(24, e.props.bodyColumns)
      const inner = columns - 4
      const task = taskOf(run.command)
      const taskRows = task === '' ? [] : fold(`▸ ${task}`, inner).slice(0, 2)
      const facts = [
        run.meta.model,
        run.meta.tokens > 0 ? `${count(run.meta.tokens)} tok` : '',
        run.meta.cost > 0 ? `$${run.meta.cost.toFixed(4)}` : '',
      ].filter(s => s !== '').join(' · ')

      const header = (
        <Box flexDirection="column" borderStyle="round" borderColor={b.color} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={b.color}>
              {b.mark} {b.word}
            </Text>
            <Text dimColor wrap="truncate-start">{facts}</Text>
          </Box>
          {taskRows.map(row => <Text wrap="truncate-end">{row}</Text>)}
        </Box>
      )

      if (run.status === 'idle') {
        return (
          <Box flexDirection="column">
            {header}
            <Text dimColor>No run yet.</Text>
            <Text dimColor>Ask Claude, e.g. "let {agent.label} …"; the run shows here live.</Text>
            <Text dimColor>{KEY} hides the tabs</Text>
          </Box>
        )
      }

      // The answer gets its own box; the log above it gets the rows left.
      const answer = run.result?.text.trim() ?? ''
      const answerRows = answer === ''
        ? 0
        : Math.min(answer.split('\n').flatMap(l => fold(l, inner)).length + 3, Math.floor(e.props.scroll.bodyRows / 2))
      const room = Math.max(3, e.props.scroll.bodyRows - (3 + taskRows.length) - answerRows - 2)
      const rows = run.lines
        .flatMap(entry =>
          entry.kind === 'tool' || entry.kind === 'out'
            ? [{ kind: entry.kind, text: PREFIX[entry.kind] + entry.text }]
            : fold(PREFIX[entry.kind] + entry.text, columns).map(text => ({ kind: entry.kind, text })),
        )
        .slice(-room)

      return (
        <Box flexDirection="column">
          {header}
          {rows.length === 0 && (
            <Text dimColor>{run.status === 'running' ? 'waiting for output…' : 'no output'}</Text>
          )}
          {rows.map(row => {
            switch (row.kind) {
              case 'think':
                return <Text dimColor italic wrap="truncate-end">{row.text}</Text>
              case 'tool':
                return <Text color="suggestion" wrap="truncate-end">{row.text}</Text>
              case 'out':
                return <Text dimColor wrap="truncate-end">{row.text}</Text>
              case 'error':
                return <Text color="error" wrap="truncate-end">{row.text}</Text>
              case 'info':
                return <Text dimColor wrap="truncate-end">{row.text}</Text>
              default:
                return <Text wrap="truncate-end">{row.text}</Text>
            }
          })}
          {answer !== '' && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={run.result?.isOk === false ? 'error' : 'success'}
              paddingX={1}
            >
              <Text bold color={run.result?.isOk === false ? 'error' : 'success'}>Answer</Text>
              <Markdown text={answer} />
            </Box>
          )}
          <Box flexDirection="row" justifyContent="flex-end" gap={2}>
            {run.status !== 'running' && (
              <Button key="clear" plain dimColor label="clear"
                onPress={() => setRun($, agent.id, () => IDLE)} />
            )}
            <Text dimColor>{KEY} hides</Text>
          </Box>
        </Box>
      )
    })
  }
}
