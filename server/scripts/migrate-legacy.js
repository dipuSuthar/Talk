/**
 * One-time migration from the OLD Talk (v1) data to the v2 schema.
 *
 *   LEGACY_SECRET_KEY=<old REACT_APP_SECRET_KEY> MONGO_URL=... node scripts/migrate-legacy.js [--dry-run]
 *
 * What it does
 *  - users:    adds search tokens / blocked list, drops isAdmin + pic (old avatars were never served)
 *  - chats:    chatName/isGroupChat/users/groupAdmin  ->  type/name/members[{user,role}]/uniqueKey/lastMessage/unread
 *              duplicate 1:1 chats between the same two people are MERGED (their messages are kept)
 *  - messages: decrypts the old client-side AES text with LEGACY_SECRET_KEY, keeps Cloudinary media as
 *              `legacyMediaUrl` (still displayed), adds the idempotency `clientId` the new unique index needs
 *
 * Run it BEFORE starting the v2 server for the first time (the server builds new unique indexes on boot).
 * It is idempotent: already-migrated documents are skipped. Take a mongodump first.
 */
import mongoose from "mongoose";
import CryptoJS from "crypto-js";
import { pathToFileURL } from "node:url";

const PLACEHOLDER = "⚠️ This message could not be decrypted";
const SALTED = "U2FsdGVkX1"; // base64 of "Salted__" - CryptoJS passphrase-encrypted payloads start with this

export function decryptLegacy(value, secret) {
  if (!value || typeof value !== "string" || !value.startsWith(SALTED)) return { text: value ?? "", decrypted: false };
  try {
    const plain = CryptoJS.AES.decrypt(value, secret).toString(CryptoJS.enc.Utf8);
    if (!plain) return { text: "", decrypted: false, failed: true };
    const parsed = JSON.parse(plain); // the old client did encrypt(JSON.stringify(text))
    return { text: typeof parsed === "string" ? parsed : String(parsed), decrypted: true };
  } catch {
    return { text: "", decrypted: false, failed: true };
  }
}

const mediaKindFromUrl = (url = "") => (/\/video\/upload\//.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : /\.gif(\?|$)/i.test(url) ? "gif" : "image");
const pairKey = (a, b) => [a.toString(), b.toString()].sort().join(":");
const preview = (text) => (text ?? "").slice(0, 120);

export async function migrateLegacy({ db, secret, dryRun = false, log = console.log }) {
  const users = db.collection("users");
  const chats = db.collection("chats");
  const messages = db.collection("messages");
  const stats = { users: 0, chats: 0, mergedChats: 0, messages: 0, undecryptable: 0, skippedChats: 0 };

  // ---------- users ----------
  for await (const u of users.find({ nameTokens: { $exists: false } })) {
    stats.users++;
    if (dryRun) continue;
    await users.updateOne(
      { _id: u._id },
      {
        $set: { nameTokens: (u.name ?? "").toLowerCase().split(/\s+/).filter(Boolean), avatar: null, about: "", blocked: [], lastSeen: null, createdAt: u.createdAt ?? u._id.getTimestamp(), updatedAt: new Date() },
        $unset: { pic: "", isAdmin: "" },
      },
    );
  }

  // ---------- messages ----------
  const failedThisRun = new Set();
  for await (const m of messages.find({ clientId: { $exists: false } })) {
    stats.messages++;
    const { text, failed } = decryptLegacy(m.content, secret);
    if (failed) {
      stats.undecryptable++;
      failedThisRun.add(m._id.toString());
    }
    const set = { text: failed ? PLACEHOLDER : text, clientId: `legacy-${m._id}` };
    if (failed) set.legacyCiphertext = m.content; // never destroy the original: a re-run with the right key recovers it
    if (m.mediaUrl) {
      set.legacyMediaUrl = m.mediaUrl;
      set.kind = mediaKindFromUrl(m.mediaUrl);
    } else {
      set.kind = "text";
    }
    if (!dryRun) await messages.updateOne({ _id: m._id }, { $set: set, $unset: { content: "", mediaUrl: "", public_id: "" } });
  }

  // Retry messages that failed earlier (e.g. the first run used the wrong key).
  for await (const m of messages.find({ legacyCiphertext: { $exists: true } })) {
    if (failedThisRun.has(m._id.toString())) continue; // already counted above
    const { text, failed } = decryptLegacy(m.legacyCiphertext, secret);
    if (failed) {
      stats.undecryptable++;
      continue;
    }
    stats.recovered = (stats.recovered ?? 0) + 1;
    if (!dryRun) await messages.updateOne({ _id: m._id }, { $set: { text }, $unset: { legacyCiphertext: "" } });
  }

  // ---------- chats ----------
  const seenDirect = new Map(); // pairKey -> kept chat _id
  for await (const c of chats.find({ uniqueKey: { $exists: false } }).sort({ _id: 1 })) {
    const userIds = (c.users ?? []).map((id) => id);
    if (!c.isGroupChat && userIds.length !== 2) {
      stats.skippedChats++;
      log(`skip malformed direct chat ${c._id} (${userIds.length} users)`);
      continue;
    }

    let uniqueKey;
    if (c.isGroupChat) uniqueKey = `g:${c._id}`;
    else {
      uniqueKey = pairKey(userIds[0], userIds[1]);
      const keep = seenDirect.get(uniqueKey) ?? (await chats.findOne({ uniqueKey }))?._id;
      if (keep && !keep.equals(c._id)) {
        // duplicate 1:1 chat from the old app: fold its messages into the first one
        stats.mergedChats++;
        if (!dryRun) {
          await messages.updateMany({ chat: c._id }, { $set: { chat: keep } });
          await chats.deleteOne({ _id: c._id });
        }
        continue;
      }
      seenDirect.set(uniqueKey, c._id);
    }

    stats.chats++;
    if (dryRun) continue;
    await chats.updateOne(
      { _id: c._id },
      {
        $set: {
          type: c.isGroupChat ? "group" : "direct",
          name: c.isGroupChat ? c.chatName : undefined,
          uniqueKey,
          createdBy: c.groupAdmin ?? userIds[0],
          members: userIds.map((user) => ({ user, role: c.groupAdmin && c.groupAdmin.equals(user) ? "admin" : "member", joinedAt: c.createdAt ?? new Date() })),
          unread: {},
        },
        $unset: { chatName: "", isGroupChat: "", users: "", groupAdmin: "", latestMessage: "", publicKey: "" },
      },
    );
    if (c.type === undefined && !c.isGroupChat) await chats.updateOne({ _id: c._id }, { $unset: { name: "" } });
  }

  // ---------- derived chat fields: lastMessage + unread counts ----------
  if (!dryRun) {
    for await (const c of chats.find({ lastMessage: { $exists: false }, members: { $exists: true } })) {
      const last = await messages.find({ chat: c._id }).sort({ _id: -1 }).limit(1).next();
      const unread = {};
      for (const { user } of c.members) {
        unread[user.toString()] = await messages.countDocuments({ chat: c._id, sender: { $ne: user }, readBy: { $ne: user } });
      }
      const set = { unread };
      if (last) set.lastMessage = { _id: last._id, sender: last.sender, kind: last.kind ?? "text", preview: last.kind === "text" ? preview(last.text) : "", createdAt: last.createdAt ?? last._id.getTimestamp() };
      await chats.updateOne({ _id: c._id }, { $set: { ...set, updatedAt: last?.createdAt ?? c.updatedAt ?? new Date() } });
    }
  }
  return stats;
}

// ---- CLI ----
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dryRun = process.argv.includes("--dry-run");
  const { MONGO_URL, LEGACY_SECRET_KEY } = process.env;
  if (!MONGO_URL) throw new Error("Set MONGO_URL");
  if (!LEGACY_SECRET_KEY) {
    console.error("Set LEGACY_SECRET_KEY to the OLD client's REACT_APP_SECRET_KEY, otherwise old messages can't be decrypted.");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URL);
  console.log(dryRun ? "DRY RUN - nothing will be written" : "Migrating...");
  const stats = await migrateLegacy({ db: mongoose.connection.db, secret: LEGACY_SECRET_KEY, dryRun });
  console.log(stats);
  if (stats.undecryptable) console.warn(`${stats.undecryptable} message(s) could not be decrypted (wrong key?). Their ciphertext is kept - re-run with the correct LEGACY_SECRET_KEY to recover them.`);
  await mongoose.disconnect();
}
