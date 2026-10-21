import mongoose from "mongoose";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Never returned unless explicitly selected (+password).
    password: { type: String, required: true, select: false },
    avatar: { type: String, default: null },
    about: { type: String, default: "", maxlength: 160 },
    // Lower-cased words of the name, used for fast indexed prefix search.
    nameTokens: { type: [String], index: true, select: false },
    blocked: { type: [Schema.Types.ObjectId], default: [], select: false },
    lastSeen: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.pre("validate", function () {
  if (this.isModified("name")) {
    this.nameTokens = this.name.toLowerCase().split(/\s+/).filter(Boolean);
  }
});

userSchema.methods.toPublic = function () {
  return {
    _id: this._id.toString(),
    name: this.name,
    avatar: this.avatar,
    about: this.about,
    lastSeen: this.lastSeen,
  };
};

export const User = mongoose.model("User", userSchema);
