import http from "node:http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { initStorage } from "./lib/storage.js";
import { createApp } from "./app.js";
import { attachSockets } from "./sockets/index.js";
import { startPurgeJob } from "./jobs/purge.js";
import { Message } from "./models/Message.js";
import { Chat } from "./models/Chat.js";
import { User } from "./models/User.js";
import { RefreshToken } from "./models/RefreshToken.js";

async function main() {
  await initStorage();
  await connectDB();
  // Make sure indexes exist (idempotent). In a big production DB you may prefer to run this as a migration.
  await Promise.all([User, Chat, Message, RefreshToken].map((m) => m.syncIndexes().catch((e) => logger.warn({ err: e, model: m.modelName }, "index sync"))));

  const server = http.createServer(createApp());
  const io = attachSockets(server);
  const purgeTimer = startPurgeJob();

  server.listen(env.PORT, () => logger.info(`Talk server listening on :${env.PORT}`));

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "shutting down");
    clearInterval(purgeTimer);
    io.close();
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
