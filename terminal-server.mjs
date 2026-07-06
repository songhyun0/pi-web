import { createServer } from "http";
import { homedir } from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import pty from "@lydell/node-pty";
import { WebSocket, WebSocketServer } from "ws";

const MAX_BACKLOG_BYTES = 2 * 1024 * 1024;
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SHELLS_PER_SCOPE = 8;
const MAX_TOTAL_SHELLS = 64;

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

function normalizeScope(rawScope, cwd) {
  const scope = rawScope && rawScope.trim() ? rawScope.trim() : `cwd:${cwd}`;
  return scope.slice(0, 384);
}

function normalizeShellId(rawShellId) {
  const id = rawShellId && rawShellId.trim() ? rawShellId.trim() : crypto.randomUUID();
  return id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96);
}

function shellKey(scope, shellId) {
  return `${scope}:shell:${shellId}`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 64 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const terminalSessions = new Map();
const wss = new WebSocketServer({ noServer: true });

function appendBacklog(session, data) {
  const text = String(data);
  session.backlog.push(text);
  session.backlogBytes += Buffer.byteLength(text, "utf8");
  while (session.backlogBytes > MAX_BACKLOG_BYTES && session.backlog.length > 0) {
    const removed = session.backlog.shift();
    session.backlogBytes -= Buffer.byteLength(removed, "utf8");
  }
}

function broadcast(session, data) {
  appendBacklog(session, data);
  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function serializeShell(session) {
  return {
    key: session.key,
    scope: session.scope,
    shellId: session.shellId,
    title: session.title,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    lastUsed: session.lastUsed,
    attached: session.clients.size,
  };
}

function listScope(scope) {
  return [...terminalSessions.values()]
    .filter((session) => session.scope === scope)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(serializeShell);
}

function destroySession(key, reason = "killed") {
  const session = terminalSessions.get(key);
  if (!session) return false;
  terminalSessions.delete(key);
  session.destroyed = true;
  const message = `\r\n\x1b[33mShell ${reason}.\x1b[0m\r\n`;
  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        client.close();
      } catch {
        // Ignore socket shutdown errors.
      }
    }
  }
  session.clients.clear();
  try {
    session.pty.kill();
  } catch {
    // Already exited.
  }
  return true;
}

function pruneForCapacity(scope) {
  const detachedInScope = [...terminalSessions.values()]
    .filter((session) => session.scope === scope && session.clients.size === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  while (listScope(scope).length >= MAX_SHELLS_PER_SCOPE && detachedInScope.length > 0) {
    const victim = detachedInScope.shift();
    destroySession(victim.key, "closed by shell limit");
  }

  const detachedAll = [...terminalSessions.values()]
    .filter((session) => session.clients.size === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  while (terminalSessions.size >= MAX_TOTAL_SHELLS && detachedAll.length > 0) {
    const victim = detachedAll.shift();
    destroySession(victim.key, "closed by shell limit");
  }
}

function createSession({ scope, shellId, title, cwd, cols, rows }) {
  pruneForCapacity(scope);
  if (listScope(scope).length >= MAX_SHELLS_PER_SCOPE) {
    throw new Error(`Too many shells for this session (max ${MAX_SHELLS_PER_SCOPE})`);
  }
  if (terminalSessions.size >= MAX_TOTAL_SHELLS) {
    throw new Error(`Too many terminal shells (max ${MAX_TOTAL_SHELLS})`);
  }

  const key = shellKey(scope, shellId);
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

  const now = Date.now();
  const session = {
    key,
    scope,
    shellId,
    title: title || `Shell ${listScope(scope).length + 1}`,
    cwd,
    cols,
    rows,
    pty: ptyProcess,
    clients: new Set(),
    backlog: [],
    backlogBytes: 0,
    createdAt: now,
    lastUsed: now,
    destroyed: false,
  };

  ptyProcess.onData((data) => {
    broadcast(session, data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (session.destroyed) return;
    broadcast(session, `\r\n\x1b[33mShell exited (code: ${exitCode})\x1b[0m\r\n`);
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) client.close();
    }
    terminalSessions.delete(key);
  });

  terminalSessions.set(key, session);
  return session;
}

function getOrCreateSession({ scope, shellId, title, cwd, cols, rows, restart }) {
  const key = shellKey(scope, shellId);
  if (restart) destroySession(key, "restarted");
  const existing = terminalSessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    if (existing.cwd !== cwd) appendBacklog(existing, `\r\n\x1b[2mAttached from ${cwd}\x1b[0m\r\n`);
    return existing;
  }
  return createSession({ scope, shellId, title, cwd, cols, rows });
}

function sessionFromUrl(url) {
  const cwd = resolveCwd(url.searchParams.get("cwd"));
  const scope = normalizeScope(url.searchParams.get("scope"), cwd);
  const shellId = normalizeShellId(url.searchParams.get("shellId"));
  const title = url.searchParams.get("title")?.trim().slice(0, 80) || undefined;
  const cols = parseDimension(url.searchParams.get("cols"), 80, 2, 500);
  const rows = parseDimension(url.searchParams.get("rows"), 24, 1, 200);
  const restart = url.searchParams.get("restart") === "1";
  return { scope, shellId, title, cwd, cols, rows, restart };
}

wss.on("connection", (ws, req) => {
  const url = parseRequestUrl(req);
  if (!url) {
    ws.close();
    return;
  }

  const session = getOrCreateSession(sessionFromUrl(url));
  session.clients.add(ws);
  session.lastUsed = Date.now();
  session.cols = parseDimension(url.searchParams.get("cols"), session.cols, 2, 500);
  session.rows = parseDimension(url.searchParams.get("rows"), session.rows, 1, 200);
  try {
    session.pty.resize(session.cols, session.rows);
  } catch {
    // Ignore resize races.
  }

  if (session.backlog.length > 0 && ws.readyState === WebSocket.OPEN) {
    ws.send(session.backlog.join(""));
  }

  ws.on("message", (data) => {
    session.lastUsed = Date.now();
    const message = data.toString("utf8");
    if (message.startsWith("{")) {
      try {
        const parsed = JSON.parse(message);
        if (parsed?.type === "resize") {
          const nextCols = parseDimension(String(parsed.cols ?? ""), session.cols, 2, 500);
          const nextRows = parseDimension(String(parsed.rows ?? ""), session.rows, 1, 200);
          session.cols = nextCols;
          session.rows = nextRows;
          session.pty.resize(nextCols, nextRows);
          return;
        }
        if (parsed?.type === "kill") {
          destroySession(session.key, "killed");
          return;
        }
      } catch {
        // Pass through as terminal input.
      }
    }
    session.pty.write(message);
  });

  const detach = () => {
    session.clients.delete(ws);
    session.lastUsed = Date.now();
  };
  ws.on("close", detach);
  ws.on("error", detach);
});

async function handleShells(req, res, url) {
  if (req.method === "GET") {
    const scope = url.searchParams.get("scope")?.slice(0, 384) || "";
    if (!scope) return json(res, 400, { error: "scope is required" });
    return json(res, 200, { shells: listScope(scope) });
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const cwd = resolveCwd(body.cwd);
      const scope = normalizeScope(body.scope, cwd);
      const shellId = normalizeShellId(body.shellId);
      const title = typeof body.title === "string" ? body.title.slice(0, 80) : undefined;
      const cols = parseDimension(String(body.cols ?? ""), 80, 2, 500);
      const rows = parseDimension(String(body.rows ?? ""), 24, 1, 200);
      const restart = body.restart === true;
      const session = getOrCreateSession({ scope, shellId, title, cwd, cols, rows, restart });
      return json(res, 200, { shell: serializeShell(session), shells: listScope(scope) });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (req.method === "DELETE") {
    const scope = url.searchParams.get("scope")?.slice(0, 384) || "";
    const shellId = url.searchParams.get("shellId")?.slice(0, 96) || "";
    if (!scope || !shellId) return json(res, 400, { error: "scope and shellId are required" });
    const killed = destroySession(shellKey(scope, shellId), "killed");
    return json(res, 200, { ok: true, killed, shells: listScope(scope) });
  }

  return json(res, 405, { error: "Method not allowed" });
}

const server = createServer((req, res) => {
  const url = parseRequestUrl(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url?.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
    res.end("ok\n");
    return;
  }

  if (url?.pathname === "/api/terminal/shells") {
    void handleShells(req, res, url);
    return;
  }

  if (url?.pathname === "/api/terminal/kill" && req.method === "POST") {
    const scope = url.searchParams.get("scope")?.slice(0, 384) || "";
    const shellId = url.searchParams.get("shellId")?.slice(0, 96) || "";
    const killed = scope && shellId ? destroySession(shellKey(scope, shellId), "killed") : false;
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({ ok: true, killed }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
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

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of terminalSessions) {
    if (session.clients.size === 0 && now - session.lastUsed > IDLE_TTL_MS) {
      destroySession(key, "idle timeout");
    }
  }
}, 60_000).unref();

function shutdown() {
  for (const key of terminalSessions.keys()) {
    destroySession(key, "server stopped");
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
