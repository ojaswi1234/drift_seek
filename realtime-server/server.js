/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const Redis = require("ioredis");

const PORT = Number(process.env.PORT || 3002);
const CHANNEL = process.env.METRICS_CHANNEL || "system_metrics";
const REDIS_URL = process.env.REDIS_URL;
const REALTIME_AUTH_TOKEN = process.env.REALTIME_AUTH_TOKEN || "";
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

if (!REDIS_URL) {
  console.error("REDIS_URL is required for realtime-server.");
  process.exit(1);
}

const requestHandler = (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, message: "Not Found" }));
};

const httpServer = createServer(requestHandler);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGINS.length > 0 ? CLIENT_ORIGINS : ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

if (REALTIME_AUTH_TOKEN) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token !== REALTIME_AUTH_TOKEN) {
      return next(new Error("Unauthorized"));
    }
    return next();
  });
}

const subscriber = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

function parseMetric(message) {
  try {
    const parsed = JSON.parse(message);
    if (!parsed || !parsed.id || !Number.isFinite(Number(parsed.latency ?? 0))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

subscriber.on("message", (channel, message) => {
  if (channel !== CHANNEL) {
    return;
  }

  const payload = parseMetric(message);
  if (!payload) {
    return;
  }

  io.emit("monitor:metric", payload);
});

subscriber.on("error", (error) => {
  console.error("Redis subscriber error:", error);
});

io.on("connection", (socket) => {
  socket.emit("monitor:ready", { connected: true });
});

async function start() {
  await subscriber.subscribe(CHANNEL);

  httpServer.listen(PORT, () => {
    console.log(`Realtime server listening on port ${PORT}`);
    console.log(`Subscribed to channel ${CHANNEL}`);
  });
}

start().catch((error) => {
  console.error("Failed to start realtime server:", error);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down realtime server...`);
  try {
    await new Promise((resolve) => io.close(() => resolve()));
    await subscriber.quit();
  } catch (error) {
    console.error("Error during shutdown:", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
