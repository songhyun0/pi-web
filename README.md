# pi-web

[中文文档](./README.zh-CN.md)

Local web UI for the [pi coding agent](https://github.com/earendil-works/pi). pi-web reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model and runtime configuration, skill management, project trust, worktrees, terminal access, Git changes, and project file preview.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

The same pi session in CLI and pi-web: structured tool calls, readable Markdown, session browsing, and cleaner results.

## Quick Start

**Run without installing:**

```bash
npx @agegr/pi-web@latest
```

**Or install globally:**

```bash
npm install -g @agegr/pi-web
pi-web
```

Then open [http://localhost:30141](http://localhost:30141). The CLI will try to open the browser automatically after the server is ready.

**Options:**

```bash
pi-web --port 8080              # custom port
pi-web --hostname 127.0.0.1     # local access only
pi-web -p 8080 -H 127.0.0.1     # combine options

PORT=8080 pi-web                # environment variable is also supported
```

## Features

- **Pick work back up**: browse previous pi conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message, fork a session into a separate route, or use `/tree` with labels, filters, search, and fold controls.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, diffs, images, audio, PDFs, and DOCX files on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar; thinking level is available in the input controls.
- **Configure less from the terminal**: manage models, login/API keys, runtime settings, project trust, model tests, and skill switches from the web UI; view keyboard shortcuts with `/hotkeys`.
- **Run quick shell commands**: `!cmd` runs bash and includes output in model context; `!!cmd` shows output without adding it to context.
- **Use richer extensions**: pi-web bridges extension dialogs, status/widgets, custom line UI, chrome, autocomplete providers, editor helpers, and theme compatibility.

## Notes

- **Data directory**: pi-web reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists, defaults, and thinking levels come from pi's config.
- **Runtime settings and trust**: `/settings` edits pi runtime settings separately from pi-web app settings. Project-scoped runtime settings and project-local resources are guarded by `/trust`.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in pi-web](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Terminal panel**: the default `pi-web` command starts the web app only. The Terminal panel requires a separate terminal server (`terminal-server.mjs`; local/dev: `npm run terminal`, default port 30142).
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.

## Development

```bash
npm install
npm run dev
```

The local dev server runs at [http://localhost:30141](http://localhost:30141). Run `npm run terminal` in a second shell when testing the Terminal panel (default port 30142).

Common checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work. See [Release checklist](./docs/release.md) for publish steps.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    app-settings/   # pi-web app settings manifest and persistence
    auth/           # OAuth and API key management
    cwd/            # custom working directory validation and browsing
    default-cwd/    # pi default working directory lookup
    file-index/     # project file index/search support
    files/          # file listing, reading, preview, and watching
    git/            # changed files and diffs
    home/           # current user home directory
    keybindings/    # web keybinding registry for /hotkeys
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    plugins/        # package plugin management
    project-trust/  # project trust status and save actions
    runtime-settings/ # pi runtime settings read/write
    sessions/       # session reads, rename, delete, context, HTML export, tree labels
    skills/         # skill listing, search, install, enable/disable
    terminal/       # terminal panel config/assets
    worktrees/      # Git worktree list/create/remove
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs
  SessionSidebar.tsx  # project selector, session tree, Explorer, worktrees
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash/user-bash controls
  MessageView.tsx     # message, thinking, tool call/result, bash rendering
  SessionCommandModals.tsx # /tree, /fork, and session command modals
  SettingsModal.tsx   # runtime/app/integration settings hub
  ProjectTrustModal.tsx # /trust UI
  HotkeysModal.tsx    # /hotkeys UI
  ExtensionUiHost.tsx # extension UI compatibility rendering
  GitChangesPanel.tsx # Git changes panel
  TerminalPanel.tsx   # terminal panel client
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
lib/
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  slash-command-registry.ts # web built-in slash command metadata
  runtime-settings-core.ts  # runtime settings descriptors/read/write
  project-trust-core.ts     # trust status, inventory, actions
  web-keybindings.ts        # keybinding registry and matching helpers
  extension-ui-bridge.ts    # extension UI compatibility layer
  user-bash.ts              # !/!! parser and formatting helpers
  session-tree-view.ts      # tree filter/search/fold/label utilities
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
bin/
  pi-web.js           # npm CLI entrypoint
terminal-server.mjs   # terminal websocket/control server
```
