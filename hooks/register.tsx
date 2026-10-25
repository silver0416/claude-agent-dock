import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  AgentChat, AgentChats, AgentId, AgentPolicy, AgentRun, AgentRuns, ChatMessage, Entry, Face, Policy, RunMeta, RunResult,
} from '../types'

type Agent = { id: AgentId; label: string; glyph: string }

const AGENTS: Agent[] = [
  { id: 'cline', label: 'Cline', glyph: '◆' },
  { id: 'agy', label: 'agy', glyph: '▲' },
  { id: 'opencode', label: 'OpenCode', glyph: '■' },
  { id: 'codex', label: 'Codex', glyph: '✦' },
]

// Each agent's own color: the icon's, or the text color for a one-color mark.
const ACCENT: Record<AgentId, string> = {
  cline: 'text',
  agy: '#3186FF',
  opencode: 'text',
  codex: '#7A9DFF',
}

// Each agent's mark, drawn two pixels to a cell with half blocks:
// "." is empty; "#" takes the agent's color (Codex's fades top to bottom);
// a letter is a color of the icon's own palette.
const ICONS: Record<AgentId, { rows: string[]; palette?: string[] }> = {
  cline: { rows: [
    ".....##.....",
    ".....##.....",
    "..########..",
    ".##########.",
    ".##########.",
    ".##..##..##.",
    "###..##..###",
    "###..##..###",
    ".##..##..##.",
    ".##########.",
    ".##########.",
    "..########..",
  ] },
  agy: {
    rows: [
      "............",
      "....aabb....",
      "....ccdb....",
      "...ceefdd...",
      "...egggff...",
      "...gghhhi...",
      "..ghhhhhhi..",
      "..hh....hh..",
      "..hh.....h..",
      ".hh......hh.",
      ".h........hh",
      "............",
    ],
    palette: ["#b7ae3b","#d46d38","#8caa55","#a96f50","#62a17b","#79727b","#4596a4","#3582d6","#7072ba"],
  },
  opencode: { rows: [
    "............",
    "..########..",
    "..########..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..########..",
    "..########..",
    "............",
  ] },
  // Its >_ face drawn by hand: at this size the traced one blurs.
  codex: { rows: [
    "....####....",
    "..########..",
    ".##########.",
    ".##########.",
    "##.#########",
    "###.########",
    "####.#######",
    "###.########",
    "##.##....###",
    ".##########.",
    "..########..",
    "....####....",
  ] },
}

// The color of one pixel, or null where the icon is empty.
function pixel(id: AgentId, x: number, y: number): string | null {
  const icon = ICONS[id]
  const ch = icon.rows[y]?.[x] ?? '.'
  if (ch === '.') return null
  if (ch !== '#') return icon.palette?.[ch.charCodeAt(0) - 97] ?? ACCENT[id]
  if (id !== 'codex') return ACCENT[id]
  const t = y / (icon.rows.length - 1)
  return t < 0.5 ? mix(CODEX_FADE[0]!, CODEX_FADE[1]!, t * 2) : mix(CODEX_FADE[1]!, CODEX_FADE[2]!, t * 2 - 1)
}

// Each agent's own icon as vector art (from the LobeHub icon set), for the
// surfaces that draw SVG; the terminal draws the pixel marks above. Codex's
// >_ is laid in white over its cloud, as its app icon has it.
const ICON_SVG: Record<AgentId, string> = {
  cline: "<svg fill=\"#A8A8A8\" fill-rule=\"evenodd\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M17.035 3.991c2.75 0 4.98 2.24 4.98 5.003v1.667l1.45 2.896a1.01 1.01 0 01-.002.909l-1.448 2.864v1.668c0 2.762-2.23 5.002-4.98 5.002H7.074c-2.751 0-4.98-2.24-4.98-5.002V17.33l-1.48-2.855a1.01 1.01 0 01-.003-.927l1.482-2.887V8.994c0-2.763 2.23-5.003 4.98-5.003h9.962zM8.265 9.6a2.274 2.274 0 00-2.274 2.274v4.042a2.274 2.274 0 004.547 0v-4.042A2.274 2.274 0 008.265 9.6zm7.326 0a2.274 2.274 0 00-2.274 2.274v4.042a2.274 2.274 0 104.548 0v-4.042A2.274 2.274 0 0015.59 9.6z\"></path><path d=\"M12.054 5.558a2.779 2.779 0 100-5.558 2.779 2.779 0 000 5.558z\"></path></svg>",
  agy: "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><mask height=\"23\" id=\"lobe-icons-antigravity-0-_R_0_\" maskUnits=\"userSpaceOnUse\" width=\"24\" x=\"0\" y=\"1\"><path d=\"M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z\" fill=\"#fff\"></path></mask><g mask=\"url(#lobe-icons-antigravity-0-_R_0_)\"><g filter=\"url(#lobe-icons-antigravity-1-_R_0_)\"><path d=\"M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z\" fill=\"#FFE432\"></path></g><g filter=\"url(#lobe-icons-antigravity-2-_R_0_)\"><path d=\"M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z\" fill=\"#FC413D\"></path></g><g filter=\"url(#lobe-icons-antigravity-3-_R_0_)\"><path d=\"M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-4-_R_0_)\"><path d=\"M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-5-_R_0_)\"><path d=\"M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-6-_R_0_)\"><path d=\"M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z\" fill=\"#3186FF\"></path></g><g filter=\"url(#lobe-icons-antigravity-7-_R_0_)\"><path d=\"M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z\" fill=\"#FBBC04\"></path></g><g filter=\"url(#lobe-icons-antigravity-8-_R_0_)\"><path d=\"M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z\" fill=\"#3186FF\"></path></g><g filter=\"url(#lobe-icons-antigravity-9-_R_0_)\"><path d=\"M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z\" fill=\"#749BFF\"></path></g><g filter=\"url(#lobe-icons-antigravity-10-_R_0_)\"><path d=\"M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z\" fill=\"#FC413D\"></path></g><g filter=\"url(#lobe-icons-antigravity-11-_R_0_)\"><path d=\"M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z\" fill=\"#FFEE48\"></path></g></g><defs><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"17.587\" id=\"lobe-icons-antigravity-1-_R_0_\" width=\"19.838\" x=\"-3.288\" y=\"-11.917\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"1.117\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"38.565\" id=\"lobe-icons-antigravity-2-_R_0_\" width=\"38.9\" x=\"4.251\" y=\"-13.493\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"5.4\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.517\" id=\"lobe-icons-antigravity-3-_R_0_\" width=\"40.955\" x=\"-21.889\" y=\"-10.592\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.517\" id=\"lobe-icons-antigravity-4-_R_0_\" width=\"40.955\" x=\"-21.889\" y=\"-10.592\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.595\" id=\"lobe-icons-antigravity-5-_R_0_\" width=\"36.632\" x=\"-19.099\" y=\"-10.278\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"34.087\" id=\"lobe-icons-antigravity-6-_R_0_\" width=\"33.533\" x=\".981\" y=\"8.758\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.363\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"35.276\" id=\"lobe-icons-antigravity-7-_R_0_\" width=\"35.978\" x=\"-6.143\" y=\"-21.659\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.954\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"46.523\" id=\"lobe-icons-antigravity-8-_R_0_\" width=\"45.114\" x=\"-11.96\" y=\"-.46\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.531\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"24.054\" id=\"lobe-icons-antigravity-9-_R_0_\" width=\"25.094\" x=\"10.485\" y=\".58\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.159\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"30.007\" id=\"lobe-icons-antigravity-10-_R_0_\" width=\"33.508\" x=\"5.833\" y=\"-12.467\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"2.669\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"26.151\" id=\"lobe-icons-antigravity-11-_R_0_\" width=\"22.194\" x=\"-8.355\" y=\"-8.876\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.303\"></feGaussianBlur></filter></defs></svg>",
  opencode: "<svg fill=\"#A8A8A8\" fill-rule=\"evenodd\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M16 6H8v12h8V6zm4 16H4V2h16v20z\"></path></svg>",
  codex: "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z\" fill=\"url(#codex-fade)\"></path><defs><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"codex-fade\" x1=\"12\" x2=\"12\" y1=\"3\" y2=\"21\"><stop stop-color=\"#B1A7FF\"></stop><stop offset=\".5\" stop-color=\"#7A9DFF\"></stop><stop offset=\"1\" stop-color=\"#3941FF\"></stop></linearGradient></defs><path d=\"M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z\" fill=\"#FFFFFF\"/></svg>",
}

// Codex's fade, from its icon: top to bottom.
const CODEX_FADE = ['#B1A7FF', '#7A9DFF', '#3941FF']

const mix = (a: string, b: string, t: number) => {
  const c = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map(i => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t).toString(16).padStart(2, '0')).join('')
}

// Lifelike mode: Clawd stands at the right of each tab's header and talks
// with the agent like a coworker, each in a speech bubble.


// Clawd, 14×10 pixels, as the logo draws it with its height doubled: a top
// row, the eyes (cut out per face), the arms right under them reaching past
// the body, one more body row, four short legs. 't' is a tear.
const CLAWD: Record<Face, string[]> = {
  default: [
    '..##########..',
    '..##########..',
    '..##.####.##..',
    '..##.####.##..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  happy: [
    '..##########..',
    '..##########..',
    '..##.####.##..',
    '..#.#.##.#.#..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  surprised: [
    '..##########..',
    '..##########..',
    '..##..##..##..',
    '..##..##..##..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  confused: [
    '..##########..',
    '..##########..',
    '..##.#######..',
    '..##.###...#..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  sad: [
    '..##########..',
    '..##########..',
    '..#.######.#..',
    '..##.####.##..',
    '####t#########',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
}

// A mark beside Clawd's head for the faces that have one.
const FACE_MARK: Record<Face, string> = { default: '', happy: '♪', surprised: '!', confused: '?', sad: '' }

// The lifelike chat, nothing scripted. Each run adds, in order:
// - handoff: Clawd's line, from the command's first line `# clawd(<face>): …`;
// - ack: the agent's `ACK: …` line, the first thing its reply says;
// - summary: its `SAY: …` line, the last (or, without one, its answer's
//   first line, or the error);
// - react: Clawd's reaction, which Claude sends through the clawd_react tool
//   once it has reviewed the run.
const CLAWD_LINE = /^\s*#\s*clawd(?:\((\w+)\))?:\s*(.+)$/m
const SAY_LINE = /^\s*SAY:\s*(.+)$/gm
const ACK_LINE = /^\s*ACK:\s*(.+)$/m

// The agent's answer without its ACK and SAY lines, which go to the bubbles.
const withoutSay = (text: string) =>
  text.replace(SAY_LINE, '').replace(new RegExp(ACK_LINE.source, 'gm'), '').trim()

const short = (text: string, max: number) => {
  const line = text.split('\n').find(row => row.trim() !== '')?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

const NO_CHAT: AgentChat = { messages: [], streak: 0 }
const NO_CHATS: AgentChats = { cline: NO_CHAT, agy: NO_CHAT, opencode: NO_CHAT, codex: NO_CHAT }
const chats = atom({ plugin: 'agent-dock', key: 'chats' } as const, NO_CHATS)

// The chat kept per agent: its last lines, enough for the bubbles.
const CHAT_KEEP = 12
// The lines shown in the header's bubbles.
const CHAT_SHOWN = 5

const chatOf = async ($: EngineInterface, id: AgentId): Promise<AgentChat> =>
  ({ ...NO_CHAT, ...(await read($, chats))[id] })

// Adds a line once per run and kind; a reaction may replace the run's last.
async function say($: EngineInterface, id: AgentId, message: ChatMessage) {
  const chat = await chatOf($, id)
  const same = (m: ChatMessage) => m.run === message.run && m.kind === message.kind
  if (message.kind !== 'react' && chat.messages.some(same)) return
  await update($, chats, all => {
    const now = { ...NO_CHAT, ...all[id] }
    const messages = [...now.messages.filter(m => !(message.kind === 'react' && same(m))), message]
    return { ...all, [id]: { ...now, messages: messages.slice(-CHAT_KEEP) } }
  })
}

// Clawd's line for a dispatch: the command's own, else the task in brief.
function handoffOf(command: string): { text: string; face: Face | '' } {
  const said = CLAWD_LINE.exec(command)
  const face = said?.[1] as Face | undefined
  return {
    text: said?.[2]?.trim() ?? short(taskOf(command), 40),
    face: face !== undefined && face in CLAWD ? face : '',
  }
}

// The agent's last word on a finished run.
function summaryOf(run: AgentRun): string {
  const answer = run.result?.text ?? ''
  const says = [...answer.matchAll(SAY_LINE)].map(m => m[1]?.trim() ?? '').filter(s => s !== '')
  if (says.length > 0) return says[says.length - 1]!
  const lastError = [...run.lines].reverse().find(l => l.kind === 'error')?.text ?? ''
  return run.status === 'error' ? short(lastError || withoutSay(answer), 80) : short(withoutSay(answer), 80)
}

// Clawd's face now: the face of its last line in this run, else the run's mood.
function faceOf(run: AgentRun, chat: AgentChat): Face {
  const mine = [...chat.messages].reverse().find(m => m.who === 'clawd' && m.run === run.startedAt && m.face !== '')
  if (mine !== undefined && mine.face !== '') return mine.face
  switch (run.status) {
    case 'running':
      return 'happy'
    case 'error':
      return 'sad'
    default:
      return 'default'
  }
}

// Each reaction's mood, its face, and what it does to the problem streak.
const MOODS = {
  praise: { face: 'happy', isProblem: false },
  thanks: { face: 'happy', isProblem: false },
  problem: { face: 'confused', isProblem: true },
  concern: { face: 'sad', isProblem: true },
} as const satisfies Record<string, { face: Face; isProblem: boolean }>
type Mood = keyof typeof MOODS

// A picture as SVG squares, for surfaces whose text rows do not meet (the
// desktop app): half blocks there leave gaps between rows. Theme keys become
// colors that read on a light or a dark ground.
const SVG_COLOR: Record<string, string> = { text: '#A8A8A8', claude: '#D97757' }
const PIXEL = 4

function svgOf(width: number, height: number, colorAt: (x: number, y: number) => string | null): string {
  const rects: string[] = []
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      const color = colorAt(x, y)
      let run = 1
      while (x + run < width && colorAt(x + run, y) === color) run += 1
      if (color !== null) {
        rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${SVG_COLOR[color] ?? color}"/>`)
      }
      x += run
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * PIXEL}" height="${height * PIXEL}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

const NO_META: RunMeta = { model: '', tokens: 0, cost: 0 }

const IDLE: AgentRun = {
  status: 'idle',
  command: '',
  log: '',
  out: '',
  outFrom: 0,
  startedAt: 0,
  endedAt: 0,
  exitCode: null,
  lines: [],
  result: null,
  meta: NO_META,
}

const NONE: AgentRuns = { cline: IDLE, agy: IDLE, opencode: IDLE, codex: IDLE }
const runs = atom({ plugin: 'agent-dock', key: 'runs' } as const, NONE)

// A run kept by an earlier version of the mod holds plain string lines.
// One kept before an agent was added has no run for it.
const settle = (run: AgentRun | undefined): AgentRun => ({
  ...IDLE,
  ...run,
  lines: (run?.lines ?? []).map(line =>
    typeof line === 'string' ? { kind: 'text', text: line } : line,
  ),
})

const runOf = async ($: EngineInterface, id: AgentId) => settle((await read($, runs))[id])
const setRun = ($: EngineInterface, id: AgentId, fn: (run: AgentRun) => AgentRun) =>
  update($, runs, all => ({ ...all, [id]: fn(settle(all[id])) }))

// A Bash command that runs one of the CLIs in command position.
const CALL =
  /(?:^|[;&|(\n]\s*|\btimeout\s+(?:-\S+\s+)*\S+\s+)(cline|agy|opencode|codex)(?=\s|$)/
// Asking a CLI for its help or version is not a run.
const HELP = /\b(?:cline|agy|opencode|codex)\s+(?:\S+\s+)?(?:--help|-h|--version|-v)\b/
const START = '__AGENT_DOCK_START__'
const EXIT = '__AGENT_DOCK_EXIT__'
const READ = 3000
const KEEP = 400

// Runs read once more after finishing empty, so each is read only once.
const reread = new Set<string>()
// The last polling error shown, so a lasting one is shown once.
let lastError = ''
// Relative output paths belong to the session's working directory.
let cwd = ''

const paneId = (id: AgentId) => `agent-dock-${id}`
const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// The CLI's own stdout file, not redirects in its task or the next command.
function redirectOf(command: string, home: string, cwd: string): { out: string; append: boolean } {
  let out = ''
  let append = false
  let i = 0
  const word = () => {
    let text = ''
    let literal = true
    const stack: string[] = []
    while (i < command.length) {
      const ch = command[i]!
      const top = stack[stack.length - 1] ?? ''
      if (top === "'") {
        if (ch === "'") stack.pop()
        else text += ch
        i += 1
        continue
      }
      if (ch === '\\') {
        const next = command[i + 1] ?? ''
        if (top === '"' && !/["$`\\\n]/.test(next)) text += ch
        else {
          if (next !== '\n') text += next
          i += 1
        }
        i += 1
        continue
      }
      if (ch === '$' && command[i + 1] === '(') {
        stack.push('(')
        literal = false
        i += 2
        continue
      }
      if (top === '(' && ch === '(') stack.push('(')
      else if (top === '(' && ch === ')') stack.pop()
      else if (ch === '"') {
        if (top === '"') stack.pop()
        else stack.push('"')
      } else if (top !== '"' && ch === "'") stack.push("'")
      else {
        if (stack.length === 0 && /[\s;&|<>()]/.test(ch)) break
        if (ch === '$' || ch === '`') literal = false
        text += ch
      }
      i += 1
    }
    return { text, literal: literal && stack.length === 0 }
  }
  while (i < command.length) {
    const ch = command[i]!
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '(' || ch === ')') break
    if (/\s/.test(ch)) { i += 1; continue }
    const redirect = /^(?:(\d*)(>>|>\||>&|>)|(&>>|&>))/.exec(command.slice(i))
    if (redirect !== null) {
      i += redirect[0].length
      while (i < command.length && /[ \t]/.test(command[i]!)) i += 1
      const target = word()
      const op = redirect[2] ?? redirect[3] ?? ''
      if ((redirect[1] !== undefined && redirect[1] !== '' && redirect[1] !== '1') || op === '>&') continue
      out = target.literal ? target.text : ''
      if (out.startsWith('~/')) out = `${home}/${out.slice(2)}`
      if (out !== '' && !/^(?:[A-Za-z]:)?\//.test(out)) out = cwd === '' ? '' : `${cwd}/${out}`
      if (out !== '') {
        const parts: string[] = []
        for (const part of out.split('/')) {
          if (part === '..') parts.pop()
          else if (part !== '' && part !== '.') parts.push(part)
        }
        out = `${out.startsWith('/') ? '/' : ''}${parts.join('/')}`
      }
      if (out === '/dev/null') out = ''
      append = out !== '' && op.endsWith('>>')
      continue
    }
    if (ch === '&') break
    if (ch === '<') { i += 1; continue }
    word()
  }
  return { out, append }
}

// A command wrap() already made, not one whose task merely names the markers.
const isWrapped = (command: string) => command.includes(`printf '%s\\n' ${START} > `)

// Runs the command as written, copying its output to the log as it comes.
// `${log}.run` names the run the log belongs to, written once the command
// truly starts: until then the log still holds the run before.
const wrap = (command: string, log: string, run: number) =>
  [
    `mkdir -p ${quote(log.replace(/\/[^/]+$/, ''))}`,
    `rm -f ${quote(`${log}.rc`)}`,
    `printf '%s\\n' ${START} > ${quote(log)}`,
    `printf '%s' ${run} > ${quote(`${log}.run`)}`,
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
  // A streamed piece of text, before its block ends (Cline).
  delta?: string
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

// A line of a CLI's styled (non-JSON) output: Cline's `[thinking] …`,
// `[tool] …` and `└ result` rows, or plain text.
function plain(text: string): Entry[] {
  if (/hook dispatch failed|^Reading additional input from stdin/.test(text)) return []
  // Codex's own log lines (`<time> ERROR codex_core::…: …`): a note, without
  // the time or thread, so that its repeats fold into one.
  const logged = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s+(?:ERROR|WARN)\s+codex_[\w:]+:\s*(.*)$/.exec(text)
  if (logged !== null) {
    const said = (logged[1] ?? '').replace(/\s*(?:for )?thread [0-9a-f-]{36}(?: not found)?/g, '').trim()
    return [{
      kind: 'info',
      text: /failed to record rollout/.test(said) ? 'Codex could not save this session\'s history (its state db is unavailable)' : `Codex: ${said}`,
    }]
  }
  const tagged = /^\[([a-z_]+)\]\s*(.*)$/.exec(text)
  if (tagged !== null) {
    const [, tag = '', rest = ''] = tagged
    return [tag === 'thinking' ? { kind: 'think', text: rest } : { kind: 'tool', text: `${tag}  ${rest}` }]
  }
  const result = /^\s*└\s*(.*)$/.exec(text)
  if (result !== null) return [{ kind: 'out', text: result[1] ?? '' }]
  return [{ kind: /\b(error|failed|exception)\b/i.test(text) ? 'error' : 'text', text }]
}

// One log line as the pane shows it; the JSON events of each CLI unpacked.
function parse(line: string): Parsed {
  const text = line.trimEnd()
  if (text.trim() === '') return { entries: [] }
  if (!text.trimStart().startsWith('{')) return { entries: plain(text) }

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

  // Codex (exec --json): items start and complete; the turn ends with usage.
  if (typeof o.type === 'string' && /^(thread|turn|item)\./.test(o.type)) {
    const item = o.item ?? {}
    const done = o.type === 'item.completed'
    if (o.type === 'turn.completed') {
      const u = o.usage ?? {}
      return { entries: [], tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) }
    }
    if (o.type === 'turn.failed') return { entries: many('error', o.error?.message ?? 'turn failed') }
    if (item.type === 'agent_message' && done) return { entries: many('text', item.text) }
    if (item.type === 'reasoning' && done) return { entries: many('think', item.text) }
    if (item.type === 'command_execution') {
      // The shell's own wrapper, `/bin/bash -lc '…'`, left out.
      const command = String(item.command ?? '').replace(/^\S*sh -lc '([\s\S]*)'$/, '$1')
      if (!done) return { entries: [{ kind: 'tool', text: `shell  ${firstLine(command)}` }] }
      const kind = item.exit_code === 0 ? 'out' : 'error'
      return { entries: [{ kind, text: firstLine(item.aggregated_output) || `exit ${item.exit_code}` }] }
    }
    if (item.type === 'file_change' && done) {
      const files = (item.changes ?? []).map((c: any) => `${c.kind} ${c.path}`).join(', ')
      return { entries: [{ kind: 'tool', text: `edit  ${firstLine(files)}` }] }
    }
    if (item.type === 'mcp_tool_call' && !done) {
      return { entries: [{ kind: 'tool', text: `${item.server}.${item.tool}  ${brief(item.arguments)}` }] }
    }
    if (item.type === 'web_search' && !done) return { entries: [{ kind: 'tool', text: `search  ${firstLine(item.query)}` }] }
    if (item.type === 'error') return { entries: many('error', item.message) }
    return { entries: [] }
  }

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
    if (ev.type === 'content_start' && ev.contentType === 'text' && typeof ev.text === 'string') {
      return { entries: [], delta: ev.text }
    }
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

// The running mark: a spinner, a frame per SPIN milliseconds.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPIN = 120

function badge(run: AgentRun, now: number): { mark: string; word: string; color: string } {
  switch (run.status) {
    case 'running':
      return {
        mark: SPINNER[Math.floor(now / SPIN) % SPINNER.length] ?? '●',
        word: `running ${seconds(now - run.startedAt)}`,
        color: 'suggestion',
      }
    case 'done':
      return { mark: '✓', word: `done ${seconds(run.endedAt - run.startedAt)}`, color: 'inactive' }
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

// Windows: C:/Users/<name>, a path both the engine and Git Bash read.
const homeDir = async ($: EngineInterface) =>
  ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '/tmp').replaceAll('\\', '/')

async function logPath($: EngineInterface, id: AgentId) {
  return `${await homeDir($)}/.claude/agent-dock/${id}.log`
}

// The model each CLI runs when the command names none, from its own settings.
const MODEL_FILES: Record<AgentId, string> = {
  cline: '.cline/data/settings/providers.json',
  agy: '.gemini/antigravity-cli/settings.json',
  opencode: '.config/opencode/opencode.jsonc',
  codex: '.codex/config.toml',
}

function modelIn(id: AgentId, text: string): string {
  switch (id) {
    case 'cline': {
      const d = JSON.parse(text)
      const provider = d.lastUsedProvider ?? ''
      const model = d.providers?.[provider]?.settings?.model ?? ''
      return model === '' ? '' : `${model} (${provider})`
    }
    case 'codex':
      // A top-level key: before the first [table].
      return /^\s*model\s*=\s*"([^"]+)"/m.exec(text.split(/^\s*\[/m)[0] ?? '')?.[1] ?? ''
    default:
      return /"model"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? ''
  }
}

// Read again at most every few seconds, so a changed setting shows soon.
const models = new Map<AgentId, { model: string; at: number }>()

// The reasoning effort a CLI's settings give its model: Codex's
// model_reasoning_effort; OpenCode's variant, which its TUI keeps per model.
async function effortOf($: EngineInterface, id: AgentId, text: string, model: string): Promise<string> {
  if (id === 'codex') {
    return /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(text.split(/^\s*\[/m)[0] ?? '')?.[1] ?? ''
  }
  if (id === 'opencode' && model !== '') {
    try {
      const state = JSON.parse(await $.fs.read(`${await homeDir($)}/.local/state/opencode/model.json`))
      const variant = state.variant?.[model]
      return typeof variant === 'string' && variant !== 'default' ? variant : ''
    } catch {}
  }
  return ''
}

async function configuredModel($: EngineInterface, id: AgentId): Promise<string> {
  const now = await $.clock.now()
  const kept = models.get(id)
  if (kept !== undefined && now - kept.at < 5000) return kept.model
  let model = ''
  try {
    const text = await $.fs.read(`${await homeDir($)}/${MODEL_FILES[id]}`)
    model = modelIn(id, text)
    const effort = await effortOf($, id, text, model)
    if (effort !== '') model = `${model} (${effort})`
  } catch {}
  models.set(id, { model, at: now })
  return model
}

// The model a command names, with the effort it names: OpenCode's
// `-m provider/model#variant`, Codex's `-c model_reasoning_effort=…`.
function commandModel(command: string): string {
  const [model = '', variant = ''] = modelOf(command).split('#')
  const effort = variant || (/model_reasoning_effort\s*=\s*\\?["']?(\w+)/.exec(command)?.[1] ?? '')
  return model === '' ? '' : effort === '' ? model : `${model} (${effort})`
}

// The log's last lines, read by the engine itself (Windows has no tail); a log
// too big for one read falls back to tail, then to the exit code alone.
async function readLog($: EngineInterface, log: string, from = 0): Promise<string | null> {
  try {
    return (await $.fs.read(log)).slice(from).split('\n').slice(-READ).join('\n')
  } catch {}
  try {
    // An append offset counts characters in the whole file, before tailing.
    const { exitCode, stdout } = await $.process.run(from === 0 ? ['tail', '-n', String(READ), log] : ['cat', log])
    if (exitCode === 0) return from === 0 ? stdout : stdout.slice(from).split('\n').slice(-READ).join('\n')
  } catch {}
  if (from !== 0) return null
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
  // The log is this run's only once its command has started and said so.
  let owner = ''
  try {
    owner = (await $.fs.read(`${run.log}.run`)).trim()
  } catch {}
  if (owner !== String(run.startedAt)) return

  const stdout = await readLog($, run.log)
  if (stdout === null) return
  const output = run.out === '' ? null : await readLog($, run.out, run.outFrom)

  let ended: number | null = null
  const rows = stdout.split('\n').filter(line => {
    if (line.startsWith(START)) return false
    if (!line.startsWith(EXIT)) return true
    ended = Number(line.slice(EXIT.length).trim())
    return false
  })
  const dockRows = rows.length
  if (output !== null) rows.push(...output.split('\n'))
  let result: RunResult | null = null
  let streamed = ''
  let tokens = 0
  let cost = 0
  const meta: RunMeta = { ...NO_META, model: modelOf(run.command) }
  const lines: Entry[] = []
  let dockLines = 0
  for (const [index, line] of rows.entries()) {
    if (index === dockRows) dockLines = lines.length
    const parsed = parse(clean(line))
    streamed += parsed.delta ?? ''
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

  // The agent's ACK line goes to its bubble, and out of the log.
  const ack = ACK_LINE.exec([streamed, ...lines.filter(l => l.kind === 'text').map(l => l.text)].join('\n'))?.[1]?.trim()
  if (ack !== undefined && ack !== '') await say($, id, { who: 'agent', kind: 'ack', text: ack, face: '', run: run.startedAt })
  // A bare `ACK:` takes its words from the next line; both leave the log.
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i]?.text ?? ''
    if (lines[i]?.kind !== 'text' || !/^\s*ACK:/.test(text)) continue
    const bare = /^\s*ACK:\s*$/.test(text) && lines[i + 1]?.kind === 'text'
    const count = bare ? 2 : 1
    if (i < dockLines) dockLines -= Math.min(count, dockLines - i)
    lines.splice(i, count)
  }

  // The last block of text is the answer: kept once, in the answer box. A CLI
  // with no result event (OpenCode, Codex) has only that block to give. Notes
  // and errors a CLI logs after its answer stay below it in the log.
  // Shell notes in the dock log stay out of a redirected answer.
  const answerFrom = output === null ? 0 : dockLines
  let end = lines.length
  while (end > answerFrom && (lines[end - 1]?.kind === 'info' || lines[end - 1]?.kind === 'error')) end -= 1
  let from = end
  while (from > answerFrom && lines[from - 1]?.kind === 'text') from -= 1
  const tail = lines.slice(from, end).map(entry => entry.text).join('\n').trim()
  if (result !== null && tail !== '' && tail === result.text.trim()) lines.splice(from, end - from)
  if (ended !== null && result === null && tail !== '') {
    result = { isOk: ended === 0, text: tail }
    lines.splice(from, end - from)
  }
  // A line a CLI repeats (a warning on every step) is shown once in a row.
  for (let i = lines.length - 1; i > 0; i--) {
    if (lines[i]?.kind === lines[i - 1]?.kind && lines[i]?.text === lines[i - 1]?.text) lines.splice(i, 1)
  }
  const now = await $.clock.now()

  await setRun($, id, current => {
    if (current.startedAt !== run.startedAt) return current
    const next = { ...current, lines: lines.slice(-KEEP), result, meta }
    if (ended === null) return next
    return { ...next, status: ended === 0 ? 'done' : 'error', exitCode: ended, endedAt: now }
  })
  if (ended !== null && run.status === 'running') {
    const finished: AgentRun = { ...run, status: ended === 0 ? 'done' : 'error', result, lines }
    await say($, id, { who: 'agent', kind: 'summary', text: summaryOf(finished) || '…', face: '', run: run.startedAt })
    const agent = AGENTS.find(a => a.id === id)
    $.ui.toast(`${agent?.label ?? id} finished ${ended === 0 ? '✓' : `✗ ${ended}`}`)
  }
}

// How Claude may hand work to the CLIs, as the person set it in the Policy tab;
// kept in the mod's store, across sessions.
const POLICY_KEY = 'policy'

const DEFAULT_POLICY: Policy = {
  when: 'asked',
  pick: 'claude',
  onFail: 'stop',
  lifelike: false,
  agents: {
    cline: { enabled: true, access: 'full', model: '', useFor: '' },
    agy: { enabled: true, access: 'full', model: '', useFor: '' },
    opencode: { enabled: true, access: 'full', model: '', useFor: '' },
    codex: { enabled: true, access: 'full', model: '', useFor: '' },
  },
}

// A stored policy, filled out with the defaults for anything it lacks.
const fillPolicy = (stored: unknown): Policy => {
  const p = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Policy>
  const agents = { ...DEFAULT_POLICY.agents }
  for (const agent of AGENTS) agents[agent.id] = { ...agents[agent.id], ...p.agents?.[agent.id] }
  return { ...DEFAULT_POLICY, ...p, agents }
}

const policyOf = async ($: EngineInterface) => fillPolicy(await $.store.get(POLICY_KEY))

async function setPolicy($: EngineInterface, fn: (policy: Policy) => Policy) {
  await $.store.set(POLICY_KEY, fn(await policyOf($)))
  $.ui.invalidate('ui.render')
  $.ui.invalidate('prompt.section')
}

// The Policy tab's setting whose choices are open under it.
let openMenu: string | null = null

const setAgentPolicy = ($: EngineInterface, id: AgentId, change: Partial<AgentPolicy>) =>
  setPolicy($, p => ({ ...p, agents: { ...p.agents, [id]: { ...p.agents[id], ...change } } }))

// Each CLI's dispatch: full-auto and read-only forms; {M} is where a model goes.
const DISPATCH: Record<AgentId, { full: string; read: string; model: string; notes: string }> = {
  opencode: {
    full: 'opencode run --format json --auto{M} "<task>" < /dev/null',
    read: 'opencode run --format json --agent plan{M} "<task>" < /dev/null',
    model: ' -m <model>',
    notes: 'Continue: `-s <sessionID>`. Its answer is the `part.text` of the "text" events.',
  },
  cline: {
    full: 'cline --json -c <dir> -t 1800{M} "<task>" < /dev/null',
    read: 'cline --json -p -c <dir> -t 1800{M} "<task>" < /dev/null',
    model: ' -m <model>',
    notes: 'Continue: `--id <session>`. Its answer is the `text` of the "run_result" line. Always pass `--json`. Cline treats a prompt with no spaces as a subcommand name and exits, so a task written without spaces (e.g. all Chinese) needs a space or an English lead-in. Continuing a session with a reasoning model can fail with "`reasoning_content` … must be passed back to the API"; then start a fresh run that carries the needed context instead of `--id`.',
  },
  codex: {
    full: 'codex exec --json --skip-git-repo-check -s workspace-write -C <dir>{M} "<task>" < /dev/null',
    read: 'codex exec --json --skip-git-repo-check -s read-only -C <dir>{M} "<task>" < /dev/null',
    model: ' -m <model>',
    notes: 'Continue: `codex exec resume <thread_id> --json "<task>"`. With workspace-write it edits and runs commands inside `<dir>` only, with no network. Its answer is the `text` of the last "agent_message" item.',
  },
  agy: {
    full: 'agy --output-format stream-json --dangerously-skip-permissions --print-timeout 1800s{M} -p "<task>" < /dev/null',
    read: 'agy --output-format stream-json --mode plan --print-timeout 1800s{M} -p "<task>" < /dev/null',
    model: ' --model "<model>"',
    notes: '`-p "<task>"` goes last. Continue: `--conversation <conversation_id>`. Its answer is the `response` of the "result" event.',
  },
}

const LIFELIKE_GUIDE = `Lifelike mode is on: each agent tab shows a chat between you, as Clawd (Claude Code's mascot), and the agent, in speech bubbles. Nothing in it is scripted, and none of it changes the work. Each run goes:
1. Clawd hands over the work. Make the command's first line a shell comment, \`# clawd: <line>\` or \`# clawd(happy|surprised|confused|sad): <line>\` to set Clawd's face, with the CLI command on the next line. Write it in the person's language, short (about 25 characters in Chinese or Japanese, 60 otherwise), casual and cheerful, a coworker handing over the work in a fun way, not the task text. When you send work back to fix, say what to fix in the same voice. The task you pass stays complete and plain.
2. The agent answers at once and at the end. Begin the task you pass with: "Open your first message with a line of its own: ACK: and one short line saying you got the task (not what you found), in the voice of <persona>, in <the person's language>. Write it before you read any file or think it through, and in that same message go straight on to the work: call your first tool right away. Do not end your turn after the ACK line." (Some CLIs end the run at a message with no tool call, so the ACK must not stand alone.) End it with: "Finally, on a line of its own, write SAY: and one or two short lines to Claude summing up what you did or found, in the voice of <persona>, in <the person's language>." Personas: Cline, an earnest and orderly robot, polite; agy, floaty and dreamy, drifting in zero gravity; OpenCode, a terse hacker of few words; Codex, confident and a little cocky.
3. Clawd reacts. Once the run has ended and you have reviewed its result, call mcp__agent-dock__clawd_react once: praise or thanks when the work is good; problem when something is wrong, saying what, and then send the fix as a new run; concern when the run failed or errored, caring first. Its result tells you how many problems in a row that agent has had; past a few, Clawd gets a little impatient, playfully, never rude.
When you relay an agent's answer, leave its ACK and SAY lines out.`

const WHEN: Record<Policy['when'], string> = {
  asked: 'Delegate only when the person asks you to hand work to an agent or names one; never on your own.',
  suggest: 'When a task suits an enabled agent (independent, well specified), you may suggest delegating it, naming the agent; dispatch only after the person agrees.',
  auto: 'You may delegate on your own judgment when a task suits an enabled agent (independent, well specified work that can run while you continue); say which agent you started and why.',
  lead: 'Lead mode, the person\'s standing request: you are the lead and the enabled agents are your team, and the person wants the work done by them, not by you. This overrides any general guidance to avoid delegating or to do work inline. Hand every task that writes or changes code, runs or fixes tests, investigates a bug, reads through a codebase or researches something to an agent before doing it yourself, and split a larger task into independent parts run on different agents at once. Your own part is the lead\'s: understand the request, gather just enough context to write a complete task, pick the agent, review what comes back (the diff, a test run), send fixes back to the agent, then integrate and report. When every suitable agent is busy, wait for one to finish rather than doing the work yourself. Do it yourself only when it is trivial (an answer you already know, a one-line change quicker than writing the task), when it needs what an agent lacks (this conversation\'s tools, a push, a question to the person), or after a failed run as the failure rule below says; then say in one line why no agent took it.',
}

// Lead mode's nudge, read beside each prompt the person types.
async function leadNote($: EngineInterface, policy: Policy): Promise<string> {
  const on = AGENTS.filter(a => policy.agents[a.id].enabled)
  const busy = (await Promise.all(on.map(async a => ((await runOf($, a.id)).status === 'running' ? a : undefined))))
    .filter(a => a !== undefined)
  const idle = on.filter(a => !busy.includes(a))
  const now = `Idle: ${idle.map(a => a.label).join(', ') || 'none'}.${busy.length === 0 ? '' : ` Running: ${busy.map(a => a.label).join(', ')}.`}`
  return `Agent dock is in lead mode: hand this request's real work (code, tests, debugging, codebase reading, research) to the enabled agents as the dispatch guide says, and keep the lead's part (task writing, review, integration) for yourself; do it yourself only when it is trivial or needs what an agent lacks, and say why. ${now}`
}

const ON_FAIL: Record<Policy['onFail'], string> = {
  stop: 'When a run fails (non-zero exit, an error event, "model unavailable", an auth or quota error), report the error to the person in one short message and stop: do not retry it, re-dispatch it, switch it to another CLI or model, or start another run unless the person asks.',
  other: 'When a run fails (non-zero exit, an error event, "model unavailable", an auth or quota error), report the error in one short message, then hand the same task once to another enabled agent that suits it; if that fails too, report and stop. Never more than one retry per task, and never the same agent again.',
}

function guideFor(policy: Policy): string {
  const on = AGENTS.filter(a => policy.agents[a.id].enabled)
  const off = AGENTS.filter(a => !policy.agents[a.id].enabled)
  if (on.length === 0) {
    return `# Agent dock\n\nThe person has turned off every coding-agent CLI in the agent dock's Policy tab (${KEY}). Do not dispatch work to Cline, agy, OpenCode or Codex; if asked to, say they are turned off there.`
  }

  const lines = on.map(agent => {
    const a = policy.agents[agent.id]
    const d = DISPATCH[agent.id]
    const model = a.model === '' ? '' : d.model.replace('<model>', a.model)
    const form = (s: string) => `\`${s.replace('{M}', model)}\``
    const access = a.access === 'read'
      ? `${form(d.read)}. Read-only by the person's choice: never give it work that changes files.`
      : `${form(d.full)}; read-only form: ${form(d.read)}.`
    const pinned = a.model === '' ? ' Uses its own default model unless the person names one.' : ` Model set by the person: ${a.model}.`
    const useFor = a.useFor === '' ? '' : ` The person prefers it for: ${a.useFor}.`
    return `- ${agent.label}: ${access}${pinned}${useFor} ${d.notes}`
  })

  const pick = policy.pick === 'claude'
    ? 'When the person asks for "an agent" without naming one, pick the enabled agent that suits the task best, using the preferences above.'
    : `When the person asks for "an agent" without naming one, use ${AGENTS.find(a => a.id === policy.pick)?.label ?? policy.pick}${policy.agents[policy.pick].enabled ? '' : ' if it is enabled, else the enabled agent that suits best'}.`

  return [
    '# Agent dock: delegating to other coding-agent CLIs',
    `The person can hand work to these coding-agent CLIs on this machine: ${on.map(a => a.label).join(', ')}. Their dispatch policy is set in the agent dock's Policy tab (${KEY}) and is written out below; follow it.`,
    WHEN[policy.when],
    'Dispatch with the Bash tool and `run_in_background: true`, so you can keep working; you are notified when it exits, then read its output file and carry on. The person watches each run live in the agent tabs (log: ~/.claude/agent-dock/<cli>.log), so do not pipe the command into tail or head, nor redirect its output to a file (`> file`, `&> file`): the tab then sees nothing. To keep a copy, end it with `| tee <file>`, which the tab still sees. One run per CLI at a time. Agents marked full auto edit files and run commands without asking; for a question that needs no changes use the read-only form.',
    lines.join('\n'),
    pick,
    ...(policy.lifelike ? [LIFELIKE_GUIDE] : []),
    ...(off.length === 0 ? [] : [`Turned off by the person: ${off.map(a => a.label).join(', ')}. Do not dispatch to them; if asked to, say they are turned off in the Policy tab.`]),
    'The other agent cannot see this conversation: write the task with full context (absolute paths, the goal, how to check it is done). It works in the directory you start it in, so start it in the project the task is about. When it has edited files, review what it changed (git diff, a test run) before you report the work as done.',
    `${ON_FAIL[policy.onFail]} A notification about a run that already ended needs no new dispatch. When the error is about the model (unavailable, no longer free, unauthorized, out of credit), say which CLI and model failed and where the person picks another: the model field in the Policy tab, or the CLI's own settings (Cline: \`cline auth\`; Codex: \`model\` in ~/.codex/config.toml; OpenCode: \`model\` in ~/.config/opencode/opencode.jsonc; agy: \`agy models\`).`,
  ].join('\n\n')
}

const KEY = 'ctrl+x d'

const TABS = [
  ...AGENTS.map(agent => ({ id: paneId(agent.id), title: `  ${agent.glyph} ${agent.label}  ` })),
  { id: 'agent-dock-policy', title: '  ⚙ Policy  ' },
]

// The tab shown when the dock was last hidden, kept across sessions.
const LAST_TAB_KEY = 'lastTab'

// Opens every tab in order (cline, agy, opencode, codex, policy), then asks
// for the one shown last time; where the surface does not raise it, the
// last tab shows, and the order stays.
async function openPanes($: EngineInterface) {
  for (const tab of TABS) await $.ui.open({ ...tab, columns: 72 })
  const lastId = String((await $.store.get(LAST_TAB_KEY)) ?? '')
  const tab = TABS.find(t => t.id === lastId)
  if (tab === undefined || tab === TABS[TABS.length - 1]) return
  // Asked to the front, never closed and reopened: the tabs keep their order.
  await $.ui.open({ ...tab, columns: 72, focus: true })
}

const isDockOpen = async ($: EngineInterface) =>
  (await $.ui.panes()).some(pane => pane.id.startsWith('agent-dock-'))

// The one switch: all the tabs come and go together.
async function toggleDock($: EngineInterface) {
  if (await isDockOpen($)) {
    const shown = (await $.ui.panes()).find(pane => pane.isShown && pane.id.startsWith('agent-dock-'))
    if (shown !== undefined) await $.store.set(LAST_TAB_KEY, shown.id)
    for (const tab of TABS) await $.ui.close({ id: tab.id })
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

// One timer, which only asks for a redraw while an agent runs: SPIN ms turns
// the spinners, and the drawing reads the logs, at most once a second.
let ticker: { cancel: () => void } | null = null
let tickedAt = 0
let polledAt = 0
let anyRunning = false

// Started from events that act; again when it has not ticked lately, since
// the engine can end an interval without a word.
function startTicker($: EngineInterface) {
  if (ticker !== null && Date.now() - tickedAt < 2000) return
  ticker?.cancel()
  tickedAt = Date.now()
  ticker = $.clock.every(SPIN, () => {
    tickedAt = Date.now()
    if (anyRunning) $.ui.invalidate('ui.render')
  }) as unknown as { cancel: () => void }
}

// From a drawing: note whether any agent runs, and read the running ones'
// logs when a second has passed since the last read.
function pollFromDrawing($: EngineInterface, all: AgentRuns, now: number) {
  const running = AGENTS.filter(agent => settle(all[agent.id]).status === 'running')
  anyRunning = running.length > 0
  if (!anyRunning || now - polledAt < 1000) return
  polledAt = now
  void (async () => {
    for (const agent of running) await poll($, agent.id)
    $.ui.invalidate('ui.render')
  })().catch(err => {
    if (String(err) === lastError) return
    lastError = String(err)
    $.ui.toast(`agent-dock: ${lastError}`)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd.replaceAll('\\', '/')
    const started = await next(e)
    // The pane of the earlier single-pane layout.
    await $.ui.close({ id: 'agent-dock' })
    // The status line entry of earlier versions; the hint now sits in the footer.
    $.ui.status(undefined)
    startTicker($)
    await $.tool.register({
      name: 'clawd_react',
      description:
        "Lifelike mode of the agent dock: shows Clawd's reaction to an agent's finished run, in a speech bubble in that agent's tab. Call it once per run, after you have reviewed the result.",
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: AGENTS.map(a => a.id), description: 'The agent whose run Clawd reacts to.' },
          mood: {
            type: 'string',
            enum: Object.keys(MOODS),
            description: 'praise or thanks when the work is good; problem when something is wrong and you will send it back; concern when the run failed or errored.',
          },
          text: { type: 'string', description: "Clawd's line: short, casual and cheerful, in the person's language." },
        },
        required: ['agent', 'mood', 'text'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'agent-dock',
      description: `Show or hide the coding-agent CLI tabs (Cline, agy, OpenCode, Codex); ${KEY}`,
      immediate: true,
    })
    return started
  })

  // Clawd's reaction to a finished run, from Claude: the bubble, the face, and
  // the problem streak, which the result reports back so Clawd's tone can follow.
  on('tool.call', { tool: /^mcp__agent-dock__clawd_react$/ }, async ($, e) => {
    const input = e as unknown as { agent?: string; mood?: string; text?: string }
    const agent = AGENTS.find(a => a.id === input.agent)
    const mood = MOODS[input.mood as Mood]
    if (agent === undefined || mood === undefined || typeof input.text !== 'string' || input.text.trim() === '') {
      return { deny: `Give agent (${AGENTS.map(a => a.id).join(', ')}), mood (${Object.keys(MOODS).join(', ')}) and text.` }
    }
    const run = await runOf($, agent.id)
    const streak = mood.isProblem ? (await chatOf($, agent.id)).streak + 1 : 0
    await update($, chats, all => ({ ...all, [agent.id]: { ...NO_CHAT, ...all[agent.id], streak } }))
    await say($, agent.id, { who: 'clawd', kind: 'react', text: input.text.trim(), face: mood.face, run: run.startedAt })
    $.ui.invalidate('ui.render')
    const tone = streak >= 3
      ? ' That is a lot in a row: let Clawd sound a little impatient now, playfully, never rude.'
      : ''
    return { result: `Shown in the ${agent.label} tab. Problems in a row with ${agent.label}: ${streak}.${tone}` }
  })

  on('prompt.compose', async ($, e, next) => {
    startTicker($)
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'agent-dock:guide', text: guideFor(await policyOf($)), scope: 'session' }],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    const policy = await policyOf($)
    if (policy.when !== 'lead' || !AGENTS.some(a => policy.agents[a.id].enabled)) return next(e)
    return next({ ...e, context: [...(e.context ?? []), await leadNote($, policy)] })
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
    startTicker($)
    const found = CALL.exec(e.command)
    // Help asked of the CLI itself, not words in the task it is given.
    const head = found === null ? '' : e.command.slice(found.index + found[0].length - found[1]!.length).split(/["'\n]/)[0] ?? ''
    if (found === null || isWrapped(e.command) || HELP.test(head)) return next(e)

    const id = found[1] as AgentId
    // The person turned it off in the Policy tab: the call does not run.
    const agentPolicy = (await policyOf($)).agents[id]
    if (!agentPolicy.enabled) {
      const label = AGENTS.find(a => a.id === id)?.label ?? id
      return { deny: `${label} is turned off in the agent dock's Policy tab (${KEY}); tell the person, and do not dispatch it another way.` }
    }
    const log = await logPath($, id)
    const { out, append } = redirectOf(e.command.slice(found.index + found[0].length - found[1]!.length), await homeDir($), cwd)
    let outFrom = 0
    if (append) {
      try { outFrom = (await $.fs.read(out)).length } catch {}
    }
    const startedAt = await $.clock.now()
    await setRun($, id, () => ({
      ...IDLE,
      status: 'running',
      command: e.command,
      log,
      out,
      outFrom,
      startedAt,
      meta: { ...NO_META, model: modelOf(e.command) },
    }))

    anyRunning = true
    await say($, id, { who: 'clawd', kind: 'handoff', ...handoffOf(e.command), run: startedAt })
    const ran = await next({ ...e, command: wrap(e.command, log, startedAt) })
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
    const now = await $.clock.now()
    const all = await read($, runs)
    pollFromDrawing($, all, now)
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
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

  // The Policy tab: how Claude may hand work to the CLIs. Each setting is a
  // button that steps to its next value, so a press shows its change at once.
  on('ui.render', { component: 'Pane', requestId: 'agent-dock-policy' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const policy = await policyOf($)

    // One row: a name, then a button showing the value. As a menu (more than
    // two values, or asked for) a press opens the choices right under the
    // row, and a pick saves and closes them; otherwise a press flips it.
    const row = <T extends string>(key: string, name: string, value: T, options: readonly (readonly [T, string])[],
      save: (next: T) => Promise<void>, asMenu = false) => {
      const at = Math.max(0, options.findIndex(([v]) => v === value))
      const pick = async (next: T, label: string) => {
        openMenu = null
        if (next !== value) {
          await save(next)
          $.ui.toast(`${name.trim()} → ${label}`)
        } else {
          $.ui.invalidate('ui.render')
        }
      }
      const isMenu = asMenu || options.length > 2
      const isOpen = isMenu && openMenu === key
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text dimColor>{name.padEnd(10)}</Text>
            <Button key={key} label={`${options[at]?.[1] ?? value}${isMenu ? (isOpen ? ' ▴' : ' ▾') : ''}`}
              onPress={async () => {
                if (!isMenu) {
                  const [next, label] = options[(at + 1) % options.length] ?? options[0]!
                  return pick(next, label)
                }
                openMenu = isOpen ? null : key
                $.ui.invalidate('ui.render')
              }} />
          </Box>
          {isOpen && (
            <Box flexDirection="column" paddingLeft={10}>
              {options.map(([v, label]) => (
                <Button key={`${key}:${v}`} plain label={`${v === value ? '●' : '○'} ${label}`}
                  onPress={() => pick(v, label)} />
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const pickOptions = [['claude', 'Claude picks'] as const, ...AGENTS.map(a => [a.id, a.label] as const)]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
          <Text bold color="suggestion">Dispatch policy</Text>
          <Text dimColor>Press a [ value ] to change it; Claude follows it from its next reply.</Text>
        </Box>

        <Box flexDirection="column">
          {row('when', 'When', policy.when, [
            ['asked', 'only when I ask'],
            ['suggest', 'Claude suggests, I confirm'],
            ['auto', 'Claude may delegate itself'],
            ['lead', 'Claude leads, agents do the work'],
          ], v => setPolicy($, p => ({ ...p, when: v })))}
          {row('pick', 'Unnamed', policy.pick, pickOptions, v => setPolicy($, p => ({ ...p, pick: v })))}
          {row('onFail', 'On fail', policy.onFail, [
            ['stop', 'report and stop'],
            ['other', 'report, retry once elsewhere'],
          ], v => setPolicy($, p => ({ ...p, onFail: v })), true)}
          {row('lifelike', 'Lifelike', policy.lifelike ? 'on' : 'off', [
            ['off', 'off'],
            ['on', 'on: Clawd chats with the agents'],
          ], v => setPolicy($, p => ({ ...p, lifelike: v === 'on' })))}
        </Box>

        {AGENTS.map(agent => {
          const a = policy.agents[agent.id]
          return (
            <Box flexDirection="column">
              <Text bold color={a.enabled ? 'text' : 'inactive'}>
                {agent.glyph} {agent.label}{a.enabled ? '' : '  (off)'}
              </Text>
              {row(`${agent.id}:enabled`, '  Use', a.enabled ? 'on' : 'off', [
                ['on', 'on'],
                ['off', 'off'],
              ], v => setAgentPolicy($, agent.id, { enabled: v === 'on' }))}
              {a.enabled && row(`${agent.id}:access`, '  Access', a.access, [
                ['full', 'full auto'],
                ['read', 'read-only'],
              ], v => setAgentPolicy($, agent.id, { access: v }))}
              {a.enabled && 'Input' in ui && (
                <ui.Input key={`${agent.id}:model`} label="  Model     " value={a.model}
                  placeholder="CLI default · type, then Enter" submitLabel="save"
                  onSubmit={async v => {
                    await setAgentPolicy($, agent.id, { model: v.trim() })
                    $.ui.toast(`${agent.label} model → ${v.trim() || 'CLI default'}`)
                  }} />
              )}
              {a.enabled && 'Input' in ui && (
                <ui.Input key={`${agent.id}:useFor`} label="  Use for   " value={a.useFor}
                  placeholder="e.g. frontend · type, then Enter" submitLabel="save"
                  onSubmit={async v => {
                    await setAgentPolicy($, agent.id, { useFor: v.trim() })
                    $.ui.toast(`${agent.label} use for → ${v.trim() || '(none)'}`)
                  }} />
              )}
            </Box>
          )
        })}

        <Box flexDirection="row" justifyContent="flex-end" gap={2}>
          <Button key="reset" plain dimColor label="reset to defaults"
            onPress={async () => {
              await setPolicy($, () => DEFAULT_POLICY)
              $.ui.toast('Dispatch policy reset')
            }} />
          <Text dimColor>{KEY} hides</Text>
        </Box>
      </Box>
    )
  })

  // One tab per agent, all kept open together.
  for (const agent of AGENTS) {
    on('ui.render', { component: 'Pane', requestId: paneId(agent.id) }, async ($, e) => {
      const ui = $.ui.resolve(e)
      const { Box, Button, Text, Markdown } = ui
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
      // Inside the header: the border, the padding, the icon and the gap beside
      // it, and in lifelike mode Clawd at the right.
      const icon = ICONS[agent.id]
      const lifelike = (await policyOf($)).lifelike
      const inner = columns - 4 - ((icon.rows[0]?.length ?? 12) + 2) - (lifelike ? 16 : 0)
      const task = taskOf(run.command)
      const taskRows = task === '' ? [] : fold(`▸ ${task}`, inner).slice(0, 2)
      const facts = [
        run.meta.model,
        run.meta.tokens > 0 ? `${count(run.meta.tokens)} tok` : '',
        run.meta.cost > 0 ? `$${run.meta.cost.toFixed(4)}` : '',
      ].filter(s => s !== '').join(' · ')

      // A picture two pixels to a cell: ▀ in the top's color over the bottom's.
      const halfBlocks = (height: number, width: number, colorAt: (x: number, y: number) => string | null) =>
        Array.from({ length: height / 2 }, (_, r) => (
          <Text>
            {Array.from({ length: width }, (_, x) => {
              const top = colorAt(x, r * 2)
              const bottom = colorAt(x, r * 2 + 1)
              if (top === null && bottom === null) return <Text> </Text>
              if (top === null) return <Text color={bottom!}>▄</Text>
              if (bottom === null) return <Text color={top}>▀</Text>
              return <Text color={top} backgroundColor={bottom}>▀</Text>
            })}
          </Text>
        ))
      // Pixel art: SVG where the surface has it, half blocks in a terminal.
      const picture = (alt: string, height: number, width: number, colorAt: (x: number, y: number) => string | null) =>
        e.surface !== 'terminal' && 'Svg' in ui
          ? [<ui.Svg source={svgOf(width, height, colorAt)} alt={alt} width={width * PIXEL} height={height * PIXEL} />]
          : halfBlocks(height, width, colorAt)
      const iconRows = e.surface !== 'terminal' && 'Svg' in ui
        ? [<ui.Svg source={ICON_SVG[agent.id]} alt={agent.label} width={48} height={48} />]
        : picture(agent.label, icon.rows.length, icon.rows[0]?.length ?? 0, (x, y) => pixel(agent.id, x, y))

      // Lifelike mode: the chat in bubbles, Clawd's at the right pointing at
      // Clawd, the agent's at the left pointing at its icon; a bubble of dots
      // while one of them is still to speak.
      const chat = await chatOf($, agent.id)
      const face = faceOf(run, chat)
      const clawd = CLAWD[face]
      const clawdRows = picture(`Clawd, ${face}`, clawd.length, clawd[0]?.length ?? 0, (x, y) => {
        const ch = clawd[y]?.[x] ?? '.'
        return ch === '.' ? null : ch === 't' ? '#6CB4FF' : 'claude'
      })
      const dots = '.'.repeat(1 + (Math.floor(now / 400) % 3))
      const said = (kind: ChatMessage['kind']) => chat.messages.some(m => m.run === run.startedAt && m.kind === kind)
      const thread: { who: ChatMessage['who']; text: string }[] = chat.messages.slice(-CHAT_SHOWN)
      if (run.status === 'running' && !said('ack')) thread.push({ who: 'agent', text: dots })
      else if (run.status !== 'idle' && run.status !== 'running' && said('summary') && !said('react')) {
        thread.push({ who: 'clawd', text: dots })
      }
      const shown = thread.slice(-CHAT_SHOWN)
      const bubbleColor = ACCENT[agent.id] === 'text' ? 'inactive' : ACCENT[agent.id]
      const bubbles = lifelike && shown.length > 0 && (
        <Box flexDirection="column">
          {shown.map(m => m.who === 'clawd'
            ? (
              <Box flexDirection="row" justifyContent="flex-end">
                <Box borderStyle="round" borderColor="claude" paddingX={1} flexShrink={1}>
                  <Text>{m.text}</Text>
                </Box>
                <Box marginTop={1}><Text color="claude">▸</Text></Box>
              </Box>
            )
            : (
              <Box flexDirection="row">
                <Box marginTop={1}><Text color={bubbleColor}>◂</Text></Box>
                <Box borderStyle="round" borderColor={bubbleColor} paddingX={1} flexShrink={1}>
                  <Text>{m.text}</Text>
                </Box>
              </Box>
            ))}
        </Box>
      )

      const header = (
        <Box flexDirection="row" gap={2} borderStyle="round" borderColor="inactive" paddingX={1}>
          <Box flexDirection="column" flexShrink={0}>{iconRows}</Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text bold color={ACCENT[agent.id]}>{agent.label}</Text>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold color={b.color}>
                {b.mark} {b.word}
              </Text>
              <Text dimColor wrap="truncate-start">{facts}</Text>
            </Box>
            {taskRows.map(row => <Text wrap="truncate-end">{row}</Text>)}
            {bubbles}
          </Box>
          {lifelike && (
            <Box flexDirection="column" flexShrink={0} alignItems="center">
              <Text bold color="claude">{FACE_MARK[face] || ' '}</Text>
              {clawdRows}
            </Box>
          )}
        </Box>
      )

      // The model in use: the running command's own, else the CLI's setting.
      const model = (run.status === 'running' && commandModel(run.command)) ||
        (await policyOf($)).agents[agent.id].model ||
        (await configuredModel($, agent.id))
      const modelRow = (
        <Text dimColor wrap="truncate-end">model: {model === '' ? 'CLI default' : model}</Text>
      )

      if (run.status === 'idle') {
        return (
          <Box flexDirection="column">
            {header}
            <Text dimColor>No run yet.</Text>
            <Text dimColor>Ask Claude, e.g. "let {agent.label} …"; the run shows here live.</Text>
            <Text dimColor>{KEY} hides the tabs</Text>
            {modelRow}
          </Box>
        )
      }

      // The answer gets its own box; the log above it gets the rows left.
      const answer = withoutSay(run.result?.text ?? '')
      const answerRows = answer === ''
        ? 0
        : Math.min(answer.split('\n').flatMap(l => fold(l, inner)).length + 3, Math.floor(e.props.scroll.bodyRows / 2))
      const room = Math.max(3, e.props.scroll.bodyRows - (2 + Math.max(icon.rows.length / 2, 2 + taskRows.length + (bubbles === false ? 0 : shown.length * 3))) - answerRows - 3)
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
                onPress={async () => {
                  await setRun($, agent.id, () => IDLE)
                  await update($, chats, all => ({ ...all, [agent.id]: NO_CHAT }))
                }} />
            )}
            <Text dimColor>{KEY} hides</Text>
          </Box>
          {modelRow}
        </Box>
      )
    })
  }
}
