import mongoose from "mongoose";

const { Schema } = mongoose;

// Refresh tokens are opaque random strings; only their SHA-256 hash is stored.
// "family" lets us revoke the whole login chain if a rotated token is replayed.
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true },
  used: { type: Boolean, default: false },
  userAgent: String,
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});
// MongoDB removes expired docs automatically.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model("RefreshToken", schema);
