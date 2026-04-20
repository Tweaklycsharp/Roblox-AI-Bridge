const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT_DIR = path.resolve(__dirname, "..");
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "server.log");
const ENV_FILE = path.join(ROOT_DIR, ".env");
const MAX_BODY_BYTES = 2 * 1024 * 1024;

fs.mkdirSync(LOG_DIR, { recursive: true });

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeBaseUrl(input) {
  let url = (input || "").trim();
  if (!url) return "";
  if (!url.startsWith("http")) url = "http://" + url;
  if (url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

loadDotEnv(ENV_FILE);

const PORT = Number(process.env.PORT || 8123);
const OLLAMA_HOST = normalizeBaseUrl(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
const OLLAMA_MODEL = (process.env.OLLAMA_MODEL || "codestral").trim();

const sessions = new Map();
const serverState = {
  startedAt: new Date().toISOString(),
  lastError: null,
};

function timestamp() {
  return new Date().toISOString();
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

function writeLog(level, message, details) {
  const prefix = `[${timestamp()}] [${level}] ${message}`;
  const block =
    details === undefined || details === null
      ? prefix
      : `${prefix}\n${typeof details === "string" ? details : safeJson(details)}`;

  if (level === "ERROR") {
    console.error(block);
  } else if (level === "WARN") {
    console.warn(block);
  } else {
    console.log(block);
  }

  try {
    fs.appendFileSync(LOG_FILE, `${block}\n`, "utf8");
  } catch (error) {
    console.error(`[${timestamp()}] [ERROR] Failed to write to log file\n${error.stack || error.message}`);
  }
}

function serializeError(error) {
  if (!error) return { message: "Unknown error", details: "No error object provided." };
  if (typeof error === "string") return { message: error, details: error };
  return {
    message: error.message || "Unknown error",
    details: error.details || error.stack || error.message || String(error),
  };
}

function readTailLines(limit) {
  if (!fs.existsSync(LOG_FILE)) return "";
  const content = fs.readFileSync(LOG_FILE, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - limit)).join("\n");
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      snapshot: null,
      clients: new Set(),
      lastPrompt: null,
      lastResult: null,
      lastError: null,
      updatedAt: timestamp(),
    });
  }
  return sessions.get(sessionId);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sseWrite(client, eventName, payload) {
  client.write(`event: ${eventName}\n`);
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(session, eventName, payload) {
  for (const client of session.clients) {
    try {
      sseWrite(client, eventName, payload);
    } catch (error) {
      session.clients.delete(client);
      try { client.end(); } catch (_) {}
    }
  }
}

function recordSessionError(sessionId, error) {
  const serialized = serializeError(error);
  serverState.lastError = { ...serialized, sessionId: sessionId || null, at: timestamp() };
  if (!sessionId) return;

  const session = getSession(sessionId);
  session.lastError = { ...serialized, at: timestamp() };
  session.updatedAt = timestamp();

  broadcast(session, "error", {
    type: "error",
    message: serialized.message,
    details: serialized.details,
  });
}

function stripLargeSources(node) {
  if (!node || typeof node !== "object") return node;
  const clone = { ...node };
  if (typeof clone.source === "string" && clone.source.length > 6000) {
    clone.source = `${clone.source.slice(0, 6000)}\n-- [truncated by bridge]`;
  }
  if (Array.isArray(clone.children)) {
    clone.children = clone.children.map(stripLargeSources);
  }
  return clone;
}

function buildPromptInput(session, userPrompt) {
  const snapshot = session.snapshot || {};
  const compactSnapshot = {
    placeName: snapshot.placeName || "",
    selectedPaths: Array.isArray(snapshot.selectedPaths) ? snapshot.selectedPaths : [],
    selection: Array.isArray(snapshot.selection) ? snapshot.selection.map(stripLargeSources) : [],
    services: Array.isArray(snapshot.services) ? snapshot.services.map(stripLargeSources) : [],
  };

  return `
You are a Roblox Studio AI Bridge. Your task is to generate a JSON batch of actions based on a user prompt and a workspace snapshot.

### RULES:
1. Return ONLY a valid JSON object. No markdown, no explanations.
2. Structure: {"summary": "...", "warnings": [], "actions": []}
3. Action Types: 
   - create_instance: {type: "create_instance", parentPath: string, className: string, name: string, source: string, properties: [{property: string, value: {kind: "string|number|boolean|Vector3|Color3|UDim2|Enum", ...}}]}
   - set_property: {type: "set_property", targetPath: string, property: string, value: {kind: "...", ...}}
   - set_source: {type: "set_source", targetPath: string, source: string}
   - rename_instance: {type: "rename_instance", targetPath: string, newName: string}
   - destroy_instance: {type: "destroy_instance", targetPath: string}
   - reparent_instance: {type: "reparent_instance", targetPath: string, parentPath: string}

### CONTEXT:
- Snapshot: ${JSON.stringify(compactSnapshot)}
- User Prompt: ${userPrompt}

### OUTPUT (JSON ONLY):
`.trim();
}

async function generateActionsFromOllama(session, prompt) {
  const fullPrompt = buildPromptInput(session, prompt);

  writeLog("INFO", "Calling Ollama API", {
    sessionId: session.sessionId,
    model: OLLAMA_MODEL,
    promptLength: prompt.length,
  });

  const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: fullPrompt,
      stream: false,
      format: "json",
      options: { temperature: 0.2, num_ctx: 32768 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  let parsed;
  try {
    parsed = JSON.parse(payload.response);
  } catch (error) {
    writeLog("ERROR", "Ollama returned invalid JSON", payload.response);
    throw new Error(`Failed to parse AI output: ${error.message}`);
  }

  if (!Array.isArray(parsed.actions)) parsed.actions = [];
  if (!Array.isArray(parsed.warnings)) parsed.warnings = [];
  if (typeof parsed.summary !== "string") parsed.summary = "No summary provided.";

  session.lastPrompt = prompt;
  session.lastResult = parsed;
  session.lastError = null;
  session.updatedAt = timestamp();

  writeLog("INFO", "AI actions generated", {
    sessionId: session.sessionId,
    actionCount: parsed.actions.length,
  });

  return parsed;
}

function buildSummaryFromSnapshot(snapshot) {
  if (!snapshot) return { placeName: "", selectionCount: 0, selectedPaths: [] };
  return {
    placeName: snapshot.placeName || "",
    selectionCount: Array.isArray(snapshot.selection) ? snapshot.selection.length : 0,
    selectedPaths: Array.isArray(snapshot.selectedPaths) ? snapshot.selectedPaths.slice(0, 4) : [],
  };
}

const server = http.createServer(async (req, res) => {
  const originUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  let requestSessionId = originUrl.searchParams.get("sessionId") || "";

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  try {
    if (req.method === "GET" && originUrl.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        port: PORT,
        ollama: { host: OLLAMA_HOST, model: OLLAMA_MODEL },
        startedAt: serverState.startedAt,
        lastError: serverState.lastError,
        sessions: sessions.size,
      });
      return;
    }

    if (req.method === "GET" && originUrl.pathname === "/logs") {
      const lines = Math.min(parseInt(originUrl.searchParams.get("lines") || "120"), 1000);
      sendJson(res, 200, { ok: true, text: readTailLines(lines) });
      return;
    }

    if (req.method === "GET" && originUrl.pathname === "/session") {
      if (!requestSessionId) return sendJson(res, 400, { ok: false, error: "Missing sessionId" });
      const session = getSession(requestSessionId);
      sendJson(res, 200, {
        ok: true,
        sessionId: requestSessionId,
        updatedAt: session.updatedAt,
        snapshotSummary: buildSummaryFromSnapshot(session.snapshot),
        lastPrompt: session.lastPrompt,
        lastResult: session.lastResult,
        lastError: session.lastError,
      });
      return;
    }

    if (req.method === "GET" && originUrl.pathname === "/stream") {
      if (!requestSessionId) return sendJson(res, 400, { ok: false, error: "Missing sessionId" });
      const session = getSession(requestSessionId);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": connected\n\n");
      session.clients.add(res);
      writeLog("INFO", "Studio stream connected", { sessionId: requestSessionId });

      const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15000);
      req.on("close", () => {
        clearInterval(keepAlive);
        session.clients.delete(res);
        writeLog("INFO", "Studio stream disconnected", { sessionId: requestSessionId });
      });
      return;
    }

    if (req.method === "POST" && originUrl.pathname === "/sync") {
      const body = await readJsonBody(req);
      requestSessionId = String(body.sessionId || "");
      if (!requestSessionId) return sendJson(res, 400, { ok: false, error: "Missing sessionId" });

      const session = getSession(requestSessionId);
      session.snapshot = body.snapshot || null;
      session.updatedAt = timestamp();

      writeLog("INFO", "Snapshot synced", { sessionId: requestSessionId });
      broadcast(session, "snapshot_synced", { ok: true });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && originUrl.pathname === "/prompt") {
      const body = await readJsonBody(req);
      requestSessionId = String(body.sessionId || "");
      const prompt = String(body.prompt || "").trim();

      if (!requestSessionId || !prompt) return sendJson(res, 400, { ok: false, error: "Invalid request" });

      const session = getSession(requestSessionId);
      const result = await generateActionsFromOllama(session, prompt);
      
      broadcast(session, "actions_ready", result);
      sendJson(res, 200, { ok: true, actionCount: result.actions.length });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Route not found" });
  } catch (error) {
    const serialized = serializeError(error);
    writeLog("ERROR", `${req.method} ${originUrl.pathname} failed`, serialized);
    recordSessionError(requestSessionId, error);
    sendJson(res, 500, { ok: false, ...serialized });
  }
});

server.on("clientError", (error, socket) => {
  writeLog("ERROR", "HTTP client error", serializeError(error));
  try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch (_) {}
});

process.on("uncaughtException", (error) => {
  writeLog("ERROR", "Uncaught exception", serializeError(error));
  process.exit(1);
});

process.on("SIGINT", () => {
  writeLog("INFO", "Bridge interrupted with Ctrl+C");
  process.exit(0);
});

server.listen(PORT, "127.0.0.1", () => {
  writeLog("INFO", `Roblox AI Bridge Ollama listening on http://127.0.0.1:${PORT}`, {
    model: OLLAMA_MODEL,
    host: OLLAMA_HOST,
    envFile: ENV_FILE,
    logFile: LOG_FILE,
  });
});