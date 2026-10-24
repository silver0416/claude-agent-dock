# agent-dock

A Claude Code mod that lets Claude hand work to other coding-agent CLIs — [Cline](https://github.com/cline/cline) (`cline`), Antigravity (`agy`), [OpenCode](https://opencode.ai) (`opencode`) and [Codex](https://github.com/openai/codex) (`codex`) — and lets you watch each run live.

- **A small switch above the prompt**, at the right: each agent's state (○ idle, a spinner while running, ✓ done, ✗ failed) and a button that shows or hides the side panel.
- **One tab per agent in the side panel**, headed by the agent's icon in its colors, showing the task, elapsed time and the run's progress as it happens: reasoning, tool calls and the final answer, unpacked from each CLI's JSON output. The bottom row shows the model in use, with its reasoning effort for Codex and OpenCode.
- **Delegation built in**: ask Claude "let opencode do …" and it starts the CLI in the background, keeps working, is notified when the run ends, reviews the result and carries on.
- **A Policy tab** for how Claude delegates: when (only when asked, suggest first, or on its own), who takes work you don't assign by name, what happens on a failure, and per agent on/off, full auto or read-only, a model, and what it is best used for. Kept across sessions; a turned-off agent's runs are refused.
- **Lifelike mode** (off by default, in the Policy tab): Clawd stands in each tab's header and chats with the agent in speech bubbles. Claude writes Clawd's line, the agent answers in its own voice, and Clawd's face follows the run (happy, surprised, confused, sad).
- A toast when a run finishes, and the shortcut among the footer's mode labels.

Claude keeps calling each CLI directly in Bash; the mod copies the command's output to `~/.claude/agent-dock/<cli>.log` for the panel (stderr is merged into stdout).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-dock --marketplace silver0416/claude-agent-dock
```

Answer `y` to add the marketplace, then press Enter for the user scope.

From a shell:

```
claude plugin install agent-dock --marketplace silver0416/claude-agent-dock
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `silver0416/claude-agent-dock`, then Add plugin.

### Keyboard shortcut (optional)

The panel toggles with `/agent-dock`. To toggle it with `ctrl+x d`, add this to `~/.claude/keybindings.json`:

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    { "context": "Global", "bindings": { "ctrl+x d": "command:agent-dock" } }
  ]
}
```

The `[-]` beside the switch above the prompt is Claude Code's own collapse mark; `ctrl+x ctrl+a` brings the row back.

## Requirements

Install and sign in to the CLIs you want to use, on the same machine: `cline`, `agy`, `opencode` and/or `codex`. Each uses its own default model (for OpenCode, set `"model"` in `~/.config/opencode/opencode.jsonc`, or `opencode run` falls back to a free model).

## Warning: runs are fully automatic

The mod tells Claude to run these CLIs with their tools auto-approved (`opencode --auto`, `agy --dangerously-skip-permissions`, Cline's default auto-approval, and Codex's `workspace-write` sandbox, which keeps Codex to the directory and off the network), so a delegated agent edits files and runs commands in the directory it is started in without asking. For questions that need no changes Claude uses each CLI's read-only mode. Commit your work before delegating changes to a repository you care about.

## License

MIT
