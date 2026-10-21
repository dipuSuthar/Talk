import mongoose from "mongoose";

const { Schema } = mongoose;

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const chatSchema = new Schema(
  {
    type: { type: String, enum: ["direct", "group"], required: true },
    name: { type: String, trim: true, maxlength: 60 },
    members: { type: [memberSchema], default: [] },
    // Always set. Direct chats: deterministic "<idA>:<idB>"; groups: "g:<own id>".
    // The plain unique index makes it impossible to create two direct chats
    // between the same pair, even under a race.
    uniqueKey: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastMessage: {
      _id: Schema.Types.ObjectId,
      sender: Schema.Types.ObjectId,
      kind: String,
      preview: String,
      createdAt: Date,
    },
    // userId -> unread count (kept in sync atomically with $inc)
    unread: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
);

chatSchema.index({ "members.user": 1, updatedAt: -1 });
chatSchema.pre("validate", function () {
  if (!this.uniqueKey) this.uniqueKey = `g:${this._id}`;
});

export const directKeyFor = (a, b) => [a.toString(), b.toString()].sort().join(":");

export const Chat = mongoose.model("Chat", chatSchema);
