import mongoose from "mongoose";
import crypto from "node:crypto";

const { Schema } = mongoose;

const mediaSchema = new Schema(
  {
    key: { type: String, default: null }, // storage key; null once purged
    mime: String,
    size: Number,
    width: Number,
    height: Number,
    blur: String, // tiny blurred data-URI placeholder
    // unlimited = normal media, once / twice = Instagram-style disappearing media
    viewPolicy: { type: String, enum: ["unlimited", "once", "twice"], default: "unlimited" },
    // userId -> number of times that recipient has opened it (updated atomically with $inc)
    views: { type: Map, of: Number, default: {} },
    exhaustedAt: Date, // every recipient used all their views
    purgedAt: Date, // file deleted from storage
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    chat: { type: Schema.Types.ObjectId, ref: "Chat", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["text", "image", "gif", "video", "sticker"], default: "text" },
    text: { type: String, default: "", maxlength: 4000 },
    sticker: { pack: String, id: String },
    media: { type: mediaSchema, default: undefined },
    readBy: { type: [Schema.Types.ObjectId], default: [] },
    clientId: { type: String, default: () => crypto.randomUUID() }, // idempotency key (client supplies one so retries never duplicate)
    deletedAt: Date,
    // Messages migrated from the old app that pointed at a Cloudinary URL.
    legacyMediaUrl: String,
  },
  { timestamps: true },
);

// The one index that matters: "latest N messages of a chat", cursor-paginated by _id.
messageSchema.index({ chat: 1, _id: -1 });
messageSchema.index({ sender: 1, clientId: 1 }, { unique: true });
messageSchema.index({ "media.exhaustedAt": 1 }, { sparse: true }); // used by the purge job

export const Message = mongoose.model("Message", messageSchema);
