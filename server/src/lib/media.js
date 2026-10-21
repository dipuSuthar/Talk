import sharp from "sharp";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { env } from "../config/env.js";
import { badRequest } from "./errors.js";
import * as storage from "./storage.js";

sharp.cache({ files: 0 }); // don't hold uploaded files open
sharp.concurrency(2);

const MB = 1024 * 1024;
const LIMITS = {
  image: env.MAX_IMAGE_MB * MB,
  gif: env.MAX_GIF_MB * MB,
  video: env.MAX_VIDEO_MB * MB,
  sticker: 1 * MB,
};
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(LIMITS));

const STILL = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const PIXELS = { limitInputPixels: 40_000_000 }; // guards against decompression bombs

const newKey = (ext) => {
  const d = new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}/${mm}/${crypto.randomUUID()}.${ext}`;
};

async function blurPlaceholder(input, opts = {}) {
  const buf = await sharp(input, { ...PIXELS, ...opts })
    .resize(20, 20, { fit: "inside" })
    .blur(2)
    .jpeg({ quality: 45 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/**
 * Validates and processes an uploaded temp file.
 * - trusts the file's real bytes (magic numbers), never the client's mimetype/extension
 * - strips EXIF/GPS metadata from every image
 * - re-encodes images to WebP (smaller, no embedded payloads)
 * Returns the media descriptor to store on the message and the final kind.
 */
export async function processUpload(tmpPath, requestedKind) {
  try {
    const type = await fileTypeFromFile(tmpPath);
    if (!type) throw badRequest("Unrecognised file type");
    const stat = await fsp.stat(tmpPath);

    // ---------- video ----------
    if (VIDEO.has(type.mime)) {
      if (requestedKind && requestedKind !== "video") throw badRequest("File is not a valid " + requestedKind);
      if (stat.size > LIMITS.video) throw badRequest(`Video is too large (max ${env.MAX_VIDEO_MB} MB)`);
      const key = newKey(type.ext === "mov" ? "mov" : type.ext);
      await storage.putFile(key, tmpPath);
      return { kind: "video", media: { key, mime: type.mime, size: stat.size } };
    }

    // ---------- animated GIF ----------
    if (type.mime === "image/gif") {
      if (requestedKind && requestedKind !== "gif") throw badRequest("File is not a valid " + requestedKind);
      if (stat.size > LIMITS.gif) throw badRequest(`GIF is too large (max ${env.MAX_GIF_MB} MB)`);
      const pipeline = sharp(tmpPath, { ...PIXELS, animated: true });
      const meta = await pipeline.metadata();
      if ((meta.pages ?? 1) > 400) throw badRequest("GIF has too many frames");
      const out = await pipeline
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75, effort: 3 })
        .toBuffer({ resolveWithObject: true });
      const key = newKey("webp");
      await storage.putBuffer(key, out.data);
      return {
        kind: "gif",
        media: {
          key,
          mime: "image/webp",
          size: out.data.length,
          width: out.info.width,
          height: out.info.pageHeight ?? out.info.height,
          blur: await blurPlaceholder(tmpPath),
        },
      };
    }

    // ---------- still image / sticker ----------
    if (STILL.has(type.mime)) {
      const kind = requestedKind === "sticker" ? "sticker" : "image";
      if (requestedKind && !["image", "sticker"].includes(requestedKind)) throw badRequest("File is not a valid " + requestedKind);
      if (stat.size > LIMITS[kind]) throw badRequest(`${kind === "sticker" ? "Sticker" : "Image"} is too large (max ${LIMITS[kind] / MB} MB)`);
      const max = kind === "sticker" ? 512 : 2048;
      const out = await sharp(tmpPath, PIXELS)
        .rotate() // apply EXIF orientation, then metadata is dropped on output
        .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
        .webp({ quality: kind === "sticker" ? 90 : 82 })
        .toBuffer({ resolveWithObject: true });
      const key = newKey("webp");
      await storage.putBuffer(key, out.data);
      return {
        kind,
        media: {
          key,
          mime: "image/webp",
          size: out.data.length,
          width: out.info.width,
          height: out.info.height,
          blur: await blurPlaceholder(out.data),
        },
      };
    }

    throw badRequest("Unsupported file. Use JPG, PNG, WebP, GIF, MP4, WebM or MOV.");
  } finally {
    await fsp.rm(tmpPath, { force: true }); // no-op if already moved
  }
}

/** Avatar: square 256px WebP. Returns the buffer. */
export async function processAvatar(tmpPath) {
  try {
    const type = await fileTypeFromFile(tmpPath);
    if (!type || !STILL.has(type.mime)) throw badRequest("Avatar must be a JPG, PNG or WebP image");
    return await sharp(tmpPath, PIXELS)
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
  } finally {
    await fsp.rm(tmpPath, { force: true });
  }
}
