import express from "express";
import cors from "cors";
import http from "node:http";
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./lib/db.js";
import userRouter from "./routes/userRouter.js";
import messageRoute from "./routes/messageRouter.js";
import groupRouter from "./routes/groupRouter.js";
import configureSocket from "./lib/configureSocket.js";

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

export const io = configureSocket(server);

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.get("/api/status", (_req, res) => res.status(200).json({
  success: true,
  status: "ok",
  database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
}));
app.use("/api/auth", userRouter);
app.use("/api/messages", messageRoute);
app.use("/api/groups", groupRouter);
app.use((err, _req, res, _next) => {
  console.error("Request error:", err.message);
  res.status(err.status || 500).json({ success: false, message: err.status ? err.message : "Internal server error" });
});

const port = Number(process.env.PORT || 5000);
try {
  await connectDB();
  // Ensure cross-instance Socket.IO pub/sub is ready before accepting traffic.
  await io.redisReady;
  // Do not reset every user's presence at startup: another server instance may
  // still have active sessions. Redis leases clean up crashed sockets instead.
  server.listen(port, () => console.log(`ChatApp API listening on port ${port}`));
} catch (error) {
  console.error("Unable to start server:", error.message);
  process.exit(1);
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  io.closePresenceSweep?.();
  io.close();
  server.close(async () => {
    await io.closeRedisClients?.();
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
