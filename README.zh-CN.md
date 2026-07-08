# pi-web

[English](./README.md)

[pi 编程智能体](https://github.com/earendil-works/pi) 的本地网页界面。它会读取本机的 pi 会话文件，在浏览器里提供会话管理、实时对话、模型和运行时配置、技能管理、项目信任、worktree、终端、Git 变更和项目文件预览。

## 快速开始

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://localhost:30141](http://localhost:30141)。命令行版本会在服务就绪后尝试自动打开浏览器。

**可选参数：**

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 127.0.0.1     # 仅本机访问
pi-web -p 8080 -H 127.0.0.1     # 组合使用

PORT=8080 pi-web                # 也支持环境变量
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息继续、复制出一条独立路线，或用带标签、过滤、搜索、折叠的 `/tree` 查看会话分支。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、diff、图片、音频、PDF 和 DOCX；文件变化会自动刷新。
- **随时掌握会话状态**：顶部会显示上下文占用、花费、压缩状态和系统提示；thinking level 可在输入区控件中选择。
- **少离开当前界面**：模型、登录/API key、运行时设置、项目信任、模型测试和技能开关都能在网页里处理；`/hotkeys` 可查看快捷键。
- **快速运行 shell 命令**：`!cmd` 会执行 bash 并把输出加入模型上下文，`!!cmd` 只显示输出、不加入上下文。
- **使用更丰富的扩展 UI**：pi-web 桥接扩展 dialog、status/widget、自定义文本 UI、chrome、autocomplete provider、editor helper 和 theme 兼容能力。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表、默认模型和 thinking levels 由 pi 的配置解析得到。
- **运行时设置和信任**：`/settings` 会把 pi runtime 设置和 pi-web app 设置分开管理；project scope 设置和 project-local 资源由 `/trust` 保护。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [pi-web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Terminal 面板**：默认 `pi-web` 命令只启动 Web app。Terminal 面板需要单独运行 terminal server（`terminal-server.mjs`；本地/开发：`npm run terminal`，默认端口 30142）。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://localhost:30141](http://localhost:30141)。测试 Terminal 面板时，在第二个 shell 中运行 `npm run terminal`（默认端口 30142）。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建，步骤见 [发布清单](./docs/release.md)。

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    app-settings/   # pi-web app 设置 manifest 和持久化
    auth/           # OAuth 和 API key 管理
    cwd/            # 自定义工作目录校验和浏览
    default-cwd/    # 获取 pi 默认工作目录
    file-index/     # 项目文件索引/搜索支持
    files/          # 文件列表、读取、预览、watch
    git/            # Git 变更和 diff
    home/           # 当前用户 home 目录
    keybindings/    # /hotkeys 的 Web keybinding registry
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    plugins/        # package plugin 管理
    project-trust/  # 项目信任状态和保存动作
    runtime-settings/ # pi runtime 设置读写
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出、tree 标签
    skills/         # skills 列表、搜索、安装、启停
    terminal/       # terminal panel 配置/资源
    worktrees/      # Git worktree 列表/创建/删除
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、Explorer、worktree
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash/user-bash controls
  MessageView.tsx     # 消息、thinking、tool call/result、bash 渲染
  SessionCommandModals.tsx # /tree、/fork 和 session command 弹窗
  SettingsModal.tsx   # runtime/app/integration 设置中心
  ProjectTrustModal.tsx # /trust UI
  HotkeysModal.tsx    # /hotkeys UI
  ExtensionUiHost.tsx # extension UI 兼容渲染
  GitChangesPanel.tsx # Git changes panel
  TerminalPanel.tsx   # terminal panel client
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  slash-command-registry.ts # Web built-in slash command 元数据
  runtime-settings-core.ts  # runtime settings descriptors/读写
  project-trust-core.ts     # trust 状态、inventory、actions
  web-keybindings.ts        # keybinding registry 和匹配工具
  extension-ui-bridge.ts    # extension UI 兼容层
  user-bash.ts              # !/!! parser 和格式化工具
  session-tree-view.ts      # tree filter/search/fold/label 工具
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
bin/
  pi-web.js           # npm CLI 入口
terminal-server.mjs   # terminal websocket/control server
```
