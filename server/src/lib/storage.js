import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

/**
 * Local-disk storage driver.
 *
 * Private media lives in <UPLOAD_DIR>/private and is NEVER exposed through a
 * static route: it can only be read through the authenticated /api/media
 * endpoint. Avatars are public by nature and live in <UPLOAD_DIR>/public.
 *
 * To move to S3 later, keep this same interface (put/stat/stream/remove).
 */
const root = path.resolve(env.UPLOAD_DIR);
export const privateDir = path.join(root, "private");
export const publicDir = path.join(root, "public");
export const tmpDir = path.join(root, "tmp");

export async function initStorage() {
  await Promise.all([privateDir, publicDir, tmpDir, path.join(publicDir, "avatars")].map((d) => fsp.mkdir(d, { recursive: true })));
}

const KEY_RE = /^[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;
function resolveKey(key) {
  if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
  return path.join(privateDir, key);
}

export async function putBuffer(key, buffer) {
  const file = resolveKey(key);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, buffer, { mode: 0o600 });
}

export async function putFile(key, srcPath) {
  const file = resolveKey(key);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    await fsp.rename(srcPath, file);
  } catch {
    await fsp.copyFile(srcPath, file); // cross-device fallback
    await fsp.unlink(srcPath).catch(() => {});
  }
  await fsp.chmod(file, 0o600).catch(() => {});
}

export const statKey = (key) => fsp.stat(resolveKey(key));
export const streamKey = (key, range) => fs.createReadStream(resolveKey(key), range);
export const removeKey = (key) => fsp.rm(resolveKey(key), { force: true });

export async function putPublic(relPath, buffer) {
  const file = path.join(publicDir, relPath);
  if (!file.startsWith(publicDir)) throw new Error("bad path");
  await fsp.writeFile(file, buffer);
}
export const removePublic = (relPath) => {
  const file = path.join(publicDir, relPath);
  if (!file.startsWith(publicDir)) return Promise.resolve();
  return fsp.rm(file, { force: true });
};
