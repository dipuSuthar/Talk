import { Router } from "express";
import { Message } from "../models/Message.js";
import { verifyMedia } from "../lib/tokens.js";
import { forbidden, notFound, AppError } from "../lib/errors.js";
import { oid } from "../lib/util.js";
import * as storage from "../lib/storage.js";

export const mediaRouter = Router();

/**
 * GET /api/media/:messageId?t=<signed grant>
 * <img>/<video> tags can't send an Authorization header, so access is granted by a
 * short-lived, user-bound token that the API hands out after its own checks.
 * Supports HTTP Range so videos can seek/stream.
 */
mediaRouter.get("/:id", async (req, res) => {
  const id = oid(req.params.id);
  const grant = verifyMedia(String(req.query.t ?? ""));
  if (grant.mid !== id.toString()) throw forbidden();

  const message = await Message.findOne({ _id: id, deletedAt: { $exists: false } }).select("media").lean();
  const md = message?.media;
  if (!md) throw notFound("Media not found");
  if (!md.key || md.purgedAt) throw new AppError(410, "This media has expired");

  let stat;
  try {
    stat = await storage.statKey(md.key);
  } catch {
    throw new AppError(410, "This media is no longer available");
  }

  const limited = md.viewPolicy && md.viewPolicy !== "unlimited";
  res.set({
    "Content-Type": md.mime,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": limited ? "private, no-store, max-age=0" : "private, max-age=3600",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? parseInt(range[1], 10) : stat.size - parseInt(range[2], 10);
    let end = range[1] && range[2] ? parseInt(range[2], 10) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
      return;
    }
    res.status(206).set({ "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
    storage.streamKey(md.key, { start, end }).on("error", () => res.destroy()).pipe(res);
    return;
  }
  res.set("Content-Length", stat.size);
  storage.streamKey(md.key).on("error", () => res.destroy()).pipe(res);
});
