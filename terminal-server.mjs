import { createServer } from "http";
import { homedir } from "os";
import path from "path";
import fs from "fs";
import pty from "@lydell/node-pty";
import { WebSocket, WebSocketServer } from "ws";

function readArg(names, fallback) {
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (names.includes(arg)) return process.argv[i + 1] ?? fallback;
    for (const name of names) {
      if (arg?.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return fallback;
}

const port = Number.parseInt(readArg(["-p", "--port"], process.env.TERMINAL_PORT ?? "30142"), 10);
const hostname = readArg(["-H", "--hostname"], process.env.TERMINAL_HOST ?? process.env.HOST ?? "127.0.0.1");

function getShell() {
  if (process.platform === "win32") return process.env.COMSPEC || "cmd.exe";
  return process.env.SHELL || "/bin/zsh";
}

function parseRequestUrl(req) {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    return null;
  }
}

function resolveCwd(rawCwd) {
  const fallback = homedir();
  const requested = rawCwd && rawCwd.trim() ? rawCwd : fallback;
  const resolved = path.resolve(requested);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return resolved;
  } catch {
    // Fall through to home.
  }
  return fallback;
}

function parseDimension(value, fallback, min, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const sessions = new Map();
const wss = new WebSocketServer({ noServer: true });

function closePtyForSocket(ws) {
  const session = sessions.get(ws);
  if (!session) return;
  sessions.delete(ws);
  try {
    session.pty.kill();
  } catch {
    // Already exited.
  }
}

wss.on("connection", (ws, req) => {
  const url = parseRequestUrl(req);
  if (!url) {
    ws.close();
    return;
  }

  const cwd = resolveCwd(url.searchParams.get("cwd"));
  const cols = parseDimension(url.searchParams.get("cols"), 80, 2, 500);
  const rows = parseDimension(url.searchParams.get("rows"), 24, 1, 200);

  const ptyProcess = pty.spawn(getShell(), [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      PWD: cwd,
    },
  });

  sessions.set(ws, { pty: ptyProcess });

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\n\x1b[33mShell exited (code: ${exitCode})\x1b[0m\r\n`);
      ws.close();
    }
    closePtyForSocket(ws);
  });

  ws.on("message", (data) => {
    const message = data.toString("utf8");
    if (message.startsWith("{")) {
      try {
        const parsed = JSON.parse(message);
        if (parsed?.type === "resize") {
          ptyProcess.resize(
            parseDimension(String(parsed.cols ?? ""), cols, 2, 500),
            parseDimension(String(parsed.rows ?? ""), rows, 1, 200)
          );
          return;
        }
      } catch {
        // Pass through as terminal input.
      }
    }
    ptyProcess.write(message);
  });

  ws.on("close", () => closePtyForSocket(ws));
  ws.on("error", () => closePtyForSocket(ws));
});

const server = createServer((req, res) => {
  const url = parseRequestUrl(req);
  if (url?.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok\n");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found\n");
});

server.on("upgrade", (req, socket, head) => {
  const url = parseRequestUrl(req);
  if (url?.pathname !== "/api/terminal/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

function shutdown() {
  for (const ws of sessions.keys()) {
    closePtyForSocket(ws);
    try {
      ws.close();
    } catch {
      // Ignore shutdown errors.
    }
  }
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, hostname, () => {
  console.log(`Terminal server ready at ws://${hostname}:${port}/api/terminal/ws`);
});
