const fs = require("fs");
const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");
const { URL } = require("url");

const ROOT_DIR = path.resolve(__dirname, "..");
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "server.log");
const ENV_FILE = path.join(ROOT_DIR, ".env");
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_LOG_LINES = 250;

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

loadDotEnv(ENV_FILE);

const PORT = Number(process.env.PORT || 8123);
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-5.4-mini").trim();

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
    console.error(`[${timestamp()}] [ERROR] Failed to write log file\n${error.stack || error.message}`);
  }
}

function serializeError(error) {
  if (!error) {
    return {
      message: "Unknown error",
      details: "No error object provided.",
    };
  }

  if (typeof error === "string") {
    return {
      message: error,
      details: error,
    };
  }

  return {
    message: error.message || "Unknown error",
    details: error.details || error.stack || error.message || String(error),
  };
}

function buildOpenAIRequestError(statusCode, rawBody, requestId, clientRequestId) {
  let parsedBody = null;

  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch (_) {
    parsedBody = null;
  }

  const apiError = parsedBody && parsedBody.error ? parsedBody.error : null;
  const apiMessage = apiError && apiError.message ? apiError.message : rawBody;
  const apiCode = apiError && apiError.code ? apiError.code : null;
  const apiType = apiError && apiError.type ? apiError.type : null;

  // Translated hint messages from French to English
  let friendlyHint =
    "Check the server console and the details below to diagnose the OpenAI call.";

  if (statusCode === 429 && apiCode === "insufficient_quota") {
    friendlyHint =
      "This API key has no quota left, or the project/organization spending limit has been reached. " +
      "Add billing/credits in the OpenAI dashboard, increase the limit if necessary, " +
      "or use another API key/project with available quota.";
  } else if (statusCode === 429) {
    friendlyHint =
      "The request was rate limited. Reduce frequency, wait a moment, or check the project's RPM/TPM limits.";
  } else if (statusCode === 401) {
    friendlyHint =
      "The API key seems invalid, disabled, or linked to the wrong project/organization.";
  }

  const error = new Error(
    `OpenAI API error ${statusCode}${apiCode ? ` (${apiCode})` : ""}: ${apiMessage}`,
  );

  error.details = [
    `HTTP status: ${statusCode}`,
    apiType ? `Type: ${apiType}` : null,
    apiCode ? `Code: ${apiCode}` : null,
    requestId ? `X-Request-Id: ${requestId}` : null,
    clientRequestId ? `X-Client-Request-Id: ${clientRequestId}` : null,
    `Hint: ${friendlyHint}`,
    "",
    "Body:",
    rawBody || "(empty body)",
  ]
    .filter(Boolean)
    .join("\n");

  error.openai = {
    statusCode,
    requestId,
    clientRequestId,
    code: apiCode,
    type: apiType,
    rawBody,
  };

  return error;
}

function readTailLines(limit) {
  if (!fs.existsSync(LOG_FILE)) {
    return "";
  }

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
      try {
        client.end();
      } catch (_) {
        // Ignore cleanup errors.
      }
    }
  }
}

function recordSessionError(sessionId, error) {
  const serialized = serializeError(error);
  serverState.lastError = {
    ...serialized,
    sessionId: sessionId || null,
    at: timestamp(),
  };

  if (!sessionId) {
    return;
  }

  const session = getSession(sessionId);
  session.lastError = {
    ...serialized,
    at: timestamp(),
  };
  session.updatedAt = timestamp();

  broadcast(session, "error", {
    type: "error",
    message: serialized.message,
    details: serialized.details,
  });
}

function stripLargeSources(node) {
  if (!node || typeof node !== "object") {
    return node;
  }

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
    selection: Array.isArray(snapshot.selection)
      ? snapshot.selection.map(stripLargeSources)
      : [],
    services: Array.isArray(snapshot.services)
      ? snapshot.services.map(stripLargeSources)
      : [],
    limitations: snapshot.limitations || {},
  };

  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You generate Roblox Studio edit actions for a local bridge. " +
            "Return only actions that can be applied by the bridge. " +
            "Supported action types are create_instance, set_property, set_source, rename_instance, destroy_instance, and reparent_instance. " +
            "Paths use the format game/Service/Child. Only reference paths present in the snapshot for existing instances. " +
            "Use set_source only on script-like instances. " +
            "For create_instance, parentPath must already exist. " +
            "Supported property value kinds are string, number, boolean, Vector3, Color3, UDim2, and Enum. " +
            "Color3 values must use 0-255 integers for r, g, b. " +
            "If the request is ambiguous or impossible from the snapshot, return an empty actions array and explain why in warnings. " +
            "Prefer small, safe edits and target the current selection when possible.",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(
            {
              prompt: userPrompt,
              snapshot: compactSnapshot,
            },
            null,
            2,
          ),
        },
      ],
    },
  ];
}

function getStructuredOutputSchema() {
  const valueSchemaRef = {
    anyOf: [
      { $ref: "#/$defs/value_string" },
      { $ref: "#/$defs/value_number" },
      { $ref: "#/$defs/value_boolean" },
      { $ref: "#/$defs/value_vector3" },
      { $ref: "#/$defs/value_color3" },
      { $ref: "#/$defs/value_udim2" },
      { $ref: "#/$defs/value_enum" },
    ],
  };

  return {
    type: "json_schema",
    name: "roblox_bridge_actions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: {
          type: "string",
        },
        warnings: {
          type: "array",
          items: {
            type: "string",
          },
        },
        actions: {
          type: "array",
          items: {
            anyOf: [
              { $ref: "#/$defs/action_create_instance" },
              { $ref: "#/$defs/action_set_property" },
              { $ref: "#/$defs/action_set_source" },
              { $ref: "#/$defs/action_rename_instance" },
              { $ref: "#/$defs/action_destroy_instance" },
              { $ref: "#/$defs/action_reparent_instance" },
            ],
          },
        },
      },
      $defs: {
        value_string: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["string"],
            },
            string: {
              type: "string",
            },
          },
          required: ["kind", "string"],
        },
        value_number: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["number"],
            },
            number: {
              type: "number",
            },
          },
          required: ["kind", "number"],
        },
        value_boolean: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["boolean"],
            },
            boolean: {
              type: "boolean",
            },
          },
          required: ["kind", "boolean"],
        },
        value_vector3: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["Vector3"],
            },
            x: {
              type: "number",
            },
            y: {
              type: "number",
            },
            z: {
              type: "number",
            },
          },
          required: ["kind", "x", "y", "z"],
        },
        value_color3: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["Color3"],
            },
            r: {
              type: "number",
            },
            g: {
              type: "number",
            },
            b: {
              type: "number",
            },
          },
          required: ["kind", "r", "g", "b"],
        },
        value_udim2: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["UDim2"],
            },
            xScale: {
              type: "number",
            },
            xOffset: {
              type: "number",
            },
            yScale: {
              type: "number",
            },
            yOffset: {
              type: "number",
            },
          },
          required: ["kind", "xScale", "xOffset", "yScale", "yOffset"],
        },
        value_enum: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["Enum"],
            },
            enumType: {
              type: "string",
            },
            enumName: {
              type: "string",
            },
          },
          required: ["kind", "enumType", "enumName"],
        },
        property_patch: {
          type: "object",
          additionalProperties: false,
          properties: {
            property: {
              type: "string",
            },
            value: valueSchemaRef,
          },
          required: ["property", "value"],
        },
        action_create_instance: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["create_instance"],
            },
            parentPath: {
              type: "string",
            },
            className: {
              type: "string",
            },
            name: {
              type: "string",
            },
            source: {
              type: ["string", "null"],
            },
            properties: {
              type: ["array", "null"],
              items: {
                $ref: "#/$defs/property_patch",
              },
            },
          },
          required: ["type", "parentPath", "className", "name", "source", "properties"],
        },
        action_set_property: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["set_property"],
            },
            targetPath: {
              type: "string",
            },
            property: {
              type: "string",
            },
            value: valueSchemaRef,
          },
          required: ["type", "targetPath", "property", "value"],
        },
        action_set_source: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["set_source"],
            },
            targetPath: {
              type: "string",
            },
            source: {
              type: "string",
            },
          },
          required: ["type", "targetPath", "source"],
        },
        action_rename_instance: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["rename_instance"],
            },
            targetPath: {
              type: "string",
            },
            newName: {
              type: "string",
            },
          },
          required: ["type", "targetPath", "newName"],
        },
        action_destroy_instance: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["destroy_instance"],
            },
            targetPath: {
              type: "string",
            },
          },
          required: ["type", "targetPath"],
        },
        action_reparent_instance: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["reparent_instance"],
            },
            targetPath: {
              type: "string",
            },
            parentPath: {
              type: "string",
            },
          },
          required: ["type", "targetPath", "parentPath"],
        },
      },
      required: ["summary", "warnings", "actions"],
    },
  };
}

async function generateActionsFromOpenAI(session, prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env or export it before starting the bridge.");
  }

  if (!session.snapshot) {
    throw new Error("No Roblox snapshot has been synced for this session yet.");
  }

  const requestBody = {
    model: OPENAI_MODEL,
    input: buildPromptInput(session, prompt),
    text: {
      format: getStructuredOutputSchema(),
    },
  };

  writeLog("INFO", "Calling OpenAI Responses API", {
    sessionId: session.sessionId,
    model: OPENAI_MODEL,
    prompt,
  });

  const clientRequestId = randomUUID();

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": clientRequestId,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const requestId = response.headers.get("x-request-id");
    throw buildOpenAIRequestError(response.status, errorText, requestId, clientRequestId);
  }

  const payload = await response.json();
  const outputText =
    typeof payload.output_text === "string"
      ? payload.output_text
      : Array.isArray(payload.output)
        ? payload.output
            .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
            .map((item) => item.text)
            .filter(Boolean)
            .join("")
        : "";

  if (!outputText) {
    throw new Error("OpenAI response did not include output_text.");
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(`Failed to parse OpenAI JSON output: ${error.message}`);
  }

  if (!Array.isArray(parsed.actions)) {
    parsed.actions = [];
  }
  if (!Array.isArray(parsed.warnings)) {
    parsed.warnings = [];
  }
  if (typeof parsed.summary !== "string") {
    parsed.summary = "No summary returned.";
  }

  session.lastPrompt = prompt;
  session.lastResult = parsed;
  session.lastError = null;
  session.updatedAt = timestamp();

  writeLog("INFO", "OpenAI actions generated", {
    sessionId: session.sessionId,
    actionCount: parsed.actions.length,
    summary: parsed.summary,
  });

  return parsed;
}

function buildSummaryFromSnapshot(snapshot) {
  if (!snapshot) {
    return {
      placeName: "",
      selectionCount: 0,
      selectedPaths: [],
    };
  }

  const selectionCount = Array.isArray(snapshot.selection) ? snapshot.selection.length : 0;
  const selectedPaths = Array.isArray(snapshot.selectedPaths)
    ? snapshot.selectedPaths.slice(0, 4)
    : [];

  return {
    placeName: snapshot.placeName || "",
    selectionCount,
    selectedPaths,
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
        model: OPENAI_MODEL,
        hasOpenAiKey: Boolean(OPENAI_API_KEY),
        startedAt: serverState.startedAt,
        logFile: LOG_FILE,
        lastError: serverState.lastError,
        sessions: sessions.size,
      });
      return;
    }

    if (req.method === "GET" && originUrl.pathname === "/logs") {
      const requestedLines = Number(originUrl.searchParams.get("lines") || 120);
      const lines = Number.isFinite(requestedLines)
        ? Math.min(Math.max(Math.floor(requestedLines), 10), 1000)
        : 120;

      sendJson(res, 200, {
        ok: true,
        logFile: LOG_FILE,
        lines,
        text: readTailLines(lines),
      });
      return;
    }

    if (req.method === "GET" && originUrl.pathname === "/session") {
      if (!requestSessionId) {
        sendJson(res, 400, { ok: false, error: "Missing sessionId" });
        return;
      }

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
      if (!requestSessionId) {
        sendJson(res, 400, { ok: false, error: "Missing sessionId" });
        return;
      }

      const session = getSession(requestSessionId);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      res.write(": connected\n\n");
      session.clients.add(res);
      session.updatedAt = timestamp();

      writeLog("INFO", "Studio stream connected", {
        sessionId: requestSessionId,
      });

      sseWrite(res, "hello", {
        type: "hello",
        sessionId: requestSessionId,
        message: "Bridge stream connected",
        snapshotSummary: buildSummaryFromSnapshot(session.snapshot),
      });

      const keepAlive = setInterval(() => {
        try {
          res.write(": keep-alive\n\n");
        } catch (_) {
          clearInterval(keepAlive);
        }
      }, 15000);

      req.on("close", () => {
        clearInterval(keepAlive);
        session.clients.delete(res);
        writeLog("INFO", "Studio stream disconnected", {
          sessionId: requestSessionId,
        });
      });

      return;
    }

    if (req.method === "POST" && originUrl.pathname === "/sync") {
      const body = await readJsonBody(req);
      requestSessionId = String(body.sessionId || "");
      if (!requestSessionId) {
        sendJson(res, 400, { ok: false, error: "Missing sessionId" });
        return;
      }

      const session = getSession(requestSessionId);
      session.snapshot = body.snapshot || null;
      session.lastError = null;
      session.updatedAt = timestamp();

      const payload = {
        type: "snapshot_synced",
        sessionId: requestSessionId,
        snapshotSummary: buildSummaryFromSnapshot(session.snapshot),
      };

      writeLog("INFO", "Snapshot synced", {
        sessionId: requestSessionId,
        snapshotSummary: payload.snapshotSummary,
      });

      broadcast(session, "snapshot", payload);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === "POST" && originUrl.pathname === "/enqueue") {
      const body = await readJsonBody(req);
      requestSessionId = String(body.sessionId || "");
      if (!requestSessionId) {
        sendJson(res, 400, { ok: false, error: "Missing sessionId" });
        return;
      }

      const session = getSession(requestSessionId);
      const result = {
        type: "actions_ready",
        summary: typeof body.summary === "string" ? body.summary : "Queued manual actions.",
        warnings: Array.isArray(body.warnings) ? body.warnings : [],
        actions: Array.isArray(body.actions) ? body.actions : [],
      };

      session.lastResult = result;
      session.lastError = null;
      session.updatedAt = timestamp();

      writeLog("INFO", "Manual actions queued", {
        sessionId: requestSessionId,
        actionCount: result.actions.length,
      });

      broadcast(session, "actions", result);

      sendJson(res, 200, {
        ok: true,
        queued: result.actions.length,
      });
      return;
    }

    if (req.method === "POST" && originUrl.pathname === "/prompt") {
      const body = await readJsonBody(req);
      requestSessionId = String(body.sessionId || "");
      const prompt = String(body.prompt || "").trim();

      if (!requestSessionId) {
        sendJson(res, 400, { ok: false, error: "Missing sessionId" });
        return;
      }

      if (!prompt) {
        sendJson(res, 400, { ok: false, error: "Missing prompt" });
        return;
      }

      const session = getSession(requestSessionId);

      broadcast(session, "info", {
        type: "info",
        message: "Generating actions from OpenAI...",
      });

      const result = await generateActionsFromOpenAI(session, prompt);
      const payload = {
        type: "actions_ready",
        summary: result.summary,
        warnings: result.warnings,
        actions: result.actions,
      };

      broadcast(session, "actions", payload);
      sendJson(res, 200, {
        ok: true,
        actionCount: result.actions.length,
        summary: result.summary,
      });
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: "Not found",
      routes: [
        "GET /health",
        "GET /logs?lines=120",
        "GET /stream?sessionId=...",
        "GET /session?sessionId=...",
        "POST /sync",
        "POST /prompt",
        "POST /enqueue",
      ],
    });
  } catch (error) {
    const serialized = serializeError(error);
    writeLog("ERROR", `${req.method} ${originUrl.pathname} failed`, {
      sessionId: requestSessionId || null,
      error: serialized,
    });
    recordSessionError(requestSessionId, error);

    sendJson(res, 500, {
      ok: false,
      error: serialized.message,
      details: serialized.details,
    });
  }
});

server.on("clientError", (error, socket) => {
  writeLog("ERROR", "HTTP client error", serializeError(error));
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch (_) {
    // Ignore socket close failures.
  }
});

process.on("uncaughtException", (error) => {
  const serialized = serializeError(error);
  writeLog("ERROR", "Uncaught exception", serialized);
  serverState.lastError = {
    ...serialized,
    sessionId: null,
    at: timestamp(),
  };
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 25);
});

process.on("unhandledRejection", (reason) => {
  const serialized = serializeError(reason);
  writeLog("ERROR", "Unhandled rejection", serialized);
  serverState.lastError = {
    ...serialized,
    sessionId: null,
    at: timestamp(),
  };
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 25);
});

process.on("SIGINT", () => {
  writeLog("INFO", "Bridge interrupted with Ctrl+C");
  process.exit(0);
});

server.on("error", (error) => {
  const serialized = serializeError(error);
  writeLog("ERROR", "HTTP server failed", serialized);
  serverState.lastError = {
    ...serialized,
    sessionId: null,
    at: timestamp(),
  };
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 25);
});

server.listen(PORT, "127.0.0.1", () => {
  writeLog("INFO", `Roblox AI Bridge listening on http://127.0.0.1:${PORT}`, {
    model: OPENAI_MODEL,
    envFile: ENV_FILE,
    logFile: LOG_FILE,
    hasOpenAiKey: Boolean(OPENAI_API_KEY),
  });

  if (!OPENAI_API_KEY) {
    writeLog(
      "WARN",
      "OPENAI_API_KEY is not set. /prompt will fail until you add it to .env or your shell environment.",
    );
  }
});