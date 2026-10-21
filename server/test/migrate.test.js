import { startServer, client } from "./helpers.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import { migrateLegacy, decryptLegacy } from "../scripts/migrate-legacy.js";

const KEY = "old-bundled-frontend-key";
const enc = (t) => CryptoJS.AES.encrypt(JSON.stringify(t), KEY).toString(); // exactly what the old client did
const { ObjectId } = mongoose.Types;
// Real ObjectIds embed their creation time; give the fake legacy messages ids that match their dates.
const mid = (iso) => ObjectId.createFromTime(Math.floor(new Date(iso).getTime() / 1000));

let srv, db;
const ids = { alice: new ObjectId(), bob: new ObjectId(), carol: new ObjectId(), dm1: new ObjectId(), dm2: new ObjectId(), grp: new ObjectId() };

before(async () => {
  srv = await startServer();
  db = mongoose.connection.db;
  // v1 had no unique indexes; remove the v2 ones so legacy-shaped docs can be inserted
  await Promise.all(["users", "chats", "messages"].map((c) => db.collection(c).dropIndexes().catch(() => {})));
  const hash = await bcrypt.hash("oldPassword1", 10);
  await db.collection("users").insertMany([
    { _id: ids.alice, name: "Alice Old", email: "alice@old.com", password: hash, pic: "uploads/1752426055983.png", isAdmin: false },
    { _id: ids.bob, name: "Bob Old", email: "bob@old.com", password: hash, pic: "https://icon-library.com/x.jpg", isAdmin: false },
    { _id: ids.carol, name: "Carol Old", email: "carol@old.com", password: hash, isAdmin: false },
  ]);
  await db.collection("chats").insertMany([
    { _id: ids.dm1, chatName: "sender", isGroupChat: false, users: [ids.alice, ids.bob], createdAt: new Date("2025-01-01") },
    { _id: ids.dm2, chatName: "sender", isGroupChat: false, users: [ids.bob, ids.alice], createdAt: new Date("2025-02-01") }, // v1 allowed duplicate 1:1 chats
    { _id: ids.grp, chatName: "Old Group", isGroupChat: true, users: [ids.alice, ids.bob, ids.carol], groupAdmin: ids.alice, createdAt: new Date("2025-01-05") },
  ]);
  await db.collection("messages").insertMany([
    { _id: mid("2025-01-02"), sender: ids.alice, chat: ids.dm1, content: enc("hello from the past"), readBy: [], createdAt: new Date("2025-01-02") },
    { _id: mid("2025-02-02"), sender: ids.bob, chat: ids.dm2, content: enc("reply in the duplicate chat"), readBy: [ids.bob], createdAt: new Date("2025-02-02") },
    { _id: mid("2025-01-03"), sender: ids.alice, chat: ids.dm1, content: "plain text from before encryption existed", readBy: [], createdAt: new Date("2025-01-03") },
    { _id: mid("2025-03-01"), sender: ids.bob, chat: ids.grp, content: "", mediaUrl: "https://res.cloudinary.com/demo/video/upload/devops/clip.mp4", readBy: [], createdAt: new Date("2025-03-01") },
    { _id: mid("2025-03-02"), sender: ids.bob, chat: ids.grp, content: "", mediaUrl: "https://res.cloudinary.com/demo/image/upload/devops/pic.jpg", readBy: [], createdAt: new Date("2025-03-02") },
    { _id: mid("2025-03-03"), sender: ids.carol, chat: ids.grp, content: enc("group text"), readBy: [ids.carol], createdAt: new Date("2025-03-03") },
    { _id: mid("2025-03-04"), sender: ids.carol, chat: ids.grp, content: "U2FsdGVkX1+garbage-from-a-different-key==", readBy: [], createdAt: new Date("2025-03-04") },
  ]);
});
after(async () => srv.stop());

describe("legacy decrypt", () => {
  it("round-trips the old client's AES format", () => {
    assert.deepEqual(decryptLegacy(enc("héllo 👋"), KEY), { text: "héllo 👋", decrypted: true });
    assert.equal(decryptLegacy("just plain", KEY).text, "just plain");
    assert.equal(decryptLegacy(enc("x"), "wrong-key").failed, true);
  });
});

describe("migrateLegacy", () => {
  it("dry run changes nothing", async () => {
    const stats = await migrateLegacy({ db, secret: KEY, dryRun: true, log: () => {} });
    assert.ok(stats.messages === 7 && stats.users === 3);
    assert.equal(await db.collection("chats").countDocuments({ uniqueKey: { $exists: true } }), 0);
  });

  it("migrates users, merges duplicate 1:1 chats, decrypts text, keeps old media", async () => {
    const stats = await migrateLegacy({ db, secret: KEY, log: () => {} });
    assert.equal(stats.mergedChats, 1);
    assert.equal(stats.undecryptable, 1);
    assert.equal(await db.collection("chats").countDocuments(), 2, "duplicate 1:1 chat folded into the first");

    const msgs = await db.collection("messages").find({ chat: ids.dm1 }).sort({ createdAt: 1 }).toArray();
    assert.deepEqual(msgs.map((m) => m.text), ["hello from the past", "plain text from before encryption existed", "reply in the duplicate chat"]);
    assert.ok(msgs.every((m) => m.clientId.startsWith("legacy-") && m.kind === "text" && m.content === undefined));

    const grp = await db.collection("messages").find({ chat: ids.grp }).sort({ createdAt: 1 }).toArray();
    assert.equal(grp[0].kind, "video");
    assert.equal(grp[1].kind, "image");
    assert.match(grp[0].legacyMediaUrl, /res\.cloudinary\.com/);
    assert.equal(grp[3].text, "⚠️ This message could not be decrypted");

    const group = await db.collection("chats").findOne({ _id: ids.grp });
    assert.equal(group.type, "group");
    assert.equal(group.name, "Old Group");
    assert.equal(group.members.find((m) => m.user.equals(ids.alice)).role, "admin");
    assert.equal(group.members.find((m) => m.user.equals(ids.bob)).role, "member");
    assert.equal(group.unread[ids.alice.toString()], 4, "Alice has 4 unread group messages (bob x2, carol x2)");
    assert.equal(group.lastMessage.preview, "⚠️ This message could not be decrypted", "latest group message is the undecryptable one");
    const user = await db.collection("users").findOne({ _id: ids.alice });
    assert.equal(user.pic, undefined);
    assert.deepEqual(user.nameTokens, ["alice", "old"]);
  });

  it("keeps the ciphertext of undecryptable messages, and a re-run with the right key recovers them", async () => {
    const lateKey = "key-the-admin-forgot";
    const id = mid("2025-03-05");
    await db.collection("messages").insertOne({ _id: id, sender: ids.carol, chat: ids.grp, content: CryptoJS.AES.encrypt(JSON.stringify("recoverable"), lateKey).toString(), readBy: [], createdAt: new Date("2025-03-05") });
    const first = await migrateLegacy({ db, secret: KEY, log: () => {} }); // wrong key
    const stuck = await db.collection("messages").findOne({ _id: id });
    assert.equal(stuck.text, "⚠️ This message could not be decrypted");
    assert.ok(stuck.legacyCiphertext, "original ciphertext preserved");
    assert.ok(first.undecryptable >= 1);
    const second = await migrateLegacy({ db, secret: lateKey, log: () => {} }); // right key for that one
    assert.equal(second.recovered, 1);
    const fixed = await db.collection("messages").findOne({ _id: id });
    assert.equal(fixed.text, "recoverable");
    assert.equal(fixed.legacyCiphertext, undefined);
  });

  it("is idempotent", async () => {
    const stats = await migrateLegacy({ db, secret: KEY, log: () => {} });
    assert.equal(stats.users + stats.chats + stats.mergedChats + stats.messages + (stats.recovered ?? 0), 0);
  });

  it("the v2 server builds its indexes on migrated data and old users can log in with their OLD password", async () => {
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch((e) => { if (!/expireAfterSeconds/.test(e.message)) throw e; })));
    const c = client(srv.base);
    const login = await c.call("POST", "/api/auth/login", { json: { email: "alice@old.com", password: "oldPassword1" } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const token = login.data.accessToken;
    const chats = (await c.call("GET", "/api/chats", { token })).data;
    assert.equal(chats.length, 2);
    const dm = chats.find((x) => x.type === "direct");
    assert.equal(dm.members.length, 2);
    const page = (await c.call("GET", `/api/chats/${dm._id}/messages`, { token })).data;
    assert.deepEqual(page.messages.map((m) => m.text), ["hello from the past", "plain text from before encryption existed", "reply in the duplicate chat"]);
    const grp = chats.find((x) => x.type === "group");
    const gm = (await c.call("GET", `/api/chats/${grp._id}/messages`, { token })).data.messages;
    assert.equal(gm[0].kind, "video");
    assert.equal(gm[0].media.legacy, true);
    assert.match(gm[0].media.url, /cloudinary/);
    // and brand-new messages still work in a migrated chat
    const sent = await c.call("POST", `/api/chats/${grp._id}/messages`, { token, json: { text: "after migration" } });
    assert.equal(sent.status, 201);
  });
});
