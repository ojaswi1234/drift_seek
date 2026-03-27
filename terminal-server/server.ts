import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import * as pty from "node-pty";
import os from "os";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["https://expert-train-6p67vjvvjrpcr6gw-3000.app.github.dev"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

function startServer() {
  io.on("connection", (socket) => {
    console.log("Secure Shell Session Started:", socket.id);

    let ptyProcess: pty.IPty | null = null;

    try {
      const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
      const customUser = socket.handshake.auth.username || "drift_user";
  const targetContainer = "ubuntu:latest"; 

// The executable is now Docker, not bash
const command = "docker";

// Arguments array for the Docker CLI
const args = [
  "run",        // Use 'exec' if connecting to an already running container
  "--rm",       // Crucial: Deletes the container when the user closes the shell
  "-it",        // Keeps STDIN open and allocates a pseudo-TTY
  "-w", "/projects", // Set initial working directory to /projects
  "-e", "TERM=dumb",
  "-e", `PS1=DRIFT_SERVER_PROMPT|\\w> `,
  "-e", "PROMPT_COMMAND=", // Disable window title sequences
  // "--network", "none", // Optional: Completely disable internet inside the shell
  targetContainer,
  "bash",       // The shell to run INSIDE the container
  "--noprofile",
  "--norc"
];
  console.log(`Secure Shell Session Started for: ${customUser}`);
      ptyProcess = pty.spawn(command, args, {
        name: "xterm-color",
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: {
          ...process.env,
          DRIFT_ENGINE_ACTIVE: "true",
        },
      });
    } catch (err) {
      console.error("Failed to spawn shell:", err);
      socket.emit("output", "\r\n[server] Failed to start shell.\r\n");
      socket.disconnect();
      return;
    }

    ptyProcess.onData((data) => {
      socket.emit("output", data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      socket.emit(
        "output",
        `\r\n[server] Shell exited (code=${exitCode}, signal=${signal}).\r\n`,
      );
    });

    socket.on("input", (data) => {
      try {
        ptyProcess?.write(data);
      } catch (err) {
        console.error("Failed to write to shell:", err);
      }
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err);
    });

    socket.on("disconnect", () => {
      console.log("Session Ended:", socket.id);
      try {
        ptyProcess?.kill();
      } catch (err) {
        console.error("Failed to kill shell process:", err);
      }
    });
  });

  httpServer.listen(3001, () => {
    console.log("Handyman Terminal running on port 3001");
  });
}

try {
  startServer();
} catch (err) {
  console.error("Error starting terminal server:", err);
  process.exit(1);
}

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

app.get("/", (req, res) => {
  res.send("Handyman Terminal Server is running.");
});
