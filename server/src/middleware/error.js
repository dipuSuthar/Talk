import multer from "multer";
import { logger } from "../lib/logger.js";
import { isProd } from "../config/env.js";

export const notFoundHandler = (req, res) => {
  res.status(404).json({ message: `Not found - ${req.originalUrl}` });
};

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large" : "Invalid upload";
    return res.status(status).json({ message });
  }
  if (err?.type === "entity.too.large") return res.status(413).json({ message: "Request is too large" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "Malformed JSON" });
  if (err?.code === 11000) return res.status(409).json({ message: "Already exists" });
  if (err?.name === "CastError") return res.status(400).json({ message: "Invalid id" });

  const status = err.status ?? 500;
  if (status >= 500) logger.error({ err, url: req.originalUrl }, "request failed");
  res.status(status).json({
    message: status >= 500 && isProd ? "Something went wrong" : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
