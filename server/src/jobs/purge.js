import { Message } from "../models/Message.js";
import * as storage from "../lib/storage.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { emitToUser } from "../services/realtime.js";
import { serializeMessage } from "../lib/serialize.js";
import { Chat } from "../models/Chat.js";

/**
 * Once every recipient has used all their views of a once/twice media message,
 * the file is kept briefly (so in-flight playback finishes) and then deleted
 * from disk. After that the message can never be opened again.
 */
export async function purgeExhaustedMedia() {
  const cutoff = new Date(Date.now() - env.PURGE_AFTER_MINUTES * 60_000);
  const due = await Message.find({
    "media.exhaustedAt": { $lt: cutoff },
    "media.purgedAt": { $exists: false },
  }).limit(200);

  for (const message of due) {
    const key = message.media.key;
    message.media.key = null;
    message.media.blur = undefined;
    message.media.purgedAt = new Date();
    await message.save();
    if (key) await storage.removeKey(key).catch((err) => logger.warn({ err }, "purge: remove failed"));
    const chat = await Chat.findById(message.chat).select("members.user");
    for (const m of chat?.members ?? []) emitToUser(m.user.toString(), "message:updated", { message: serializeMessage(message, m.user) });
  }
  if (due.length) logger.info({ count: due.length }, "purged expired view-once media");
  return due.length;
}

export function startPurgeJob() {
  const timer = setInterval(() => purgeExhaustedMedia().catch((err) => logger.error({ err }, "purge job failed")), 60_000);
  timer.unref();
  return timer;
}
