import mongoose from "mongoose";
import crypto from "node:crypto";
import { badRequest } from "./errors.js";

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function oid(value, label = "id") {
  if (!mongoose.isValidObjectId(value) || String(value).length !== 24) {
    throw badRequest(`Invalid ${label}`);
  }
  return new mongoose.Types.ObjectId(String(value));
}
export const idStr = (v) => (v?._id ?? v)?.toString();
