import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import mongoose from "mongoose";
import { env, clientOrigins } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { globalLimiter } from "./middleware/limits.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { chatsRouter } from "./routes/chats.js";
import { messagesRouter } from "./routes/messages.js";
import { mediaRouter } from "./routes/media.js";
import { publicDir } from "./lib/storage.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: clientOrigins, credentials: true, maxAge: 600 }));
  app.use(compression());
  app.use(express.json({ limit: "20kb" })); // text/sticker messages are tiny; media uses multipart
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? "ok" : "degraded", db: dbUp });
  });

  // Public avatars only. Private chat media is NOT served statically.
  app.use("/uploads", express.static(publicDir, { immutable: true, maxAge: "30d", index: false, dotfiles: "deny", setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff") }));

  app.use("/api", globalLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/chats", chatsRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/media", mediaRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
