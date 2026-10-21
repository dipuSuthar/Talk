import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { tmpDir } from "../lib/storage.js";
import { MAX_UPLOAD_BYTES } from "../lib/media.js";

// Files land in a private temp dir under random names; the original filename is never used.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
});

export const uploadMedia = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 12, parts: 14 } }).single("file");
export const uploadAvatar = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 } }).single("avatar");
export const tmpName = (p) => path.basename(p);
