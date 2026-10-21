import { startServer, client, isRealMongo } from "./helpers.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { io as ioc } from "socket.io-client";

let srv;
const users = {};

const png = (color = "#ff0000") =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer();
const jpegWithExif = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#00ff00" } })
    .withExif({ IFD0: { Copyright: "SECRET-GPS-OWNER" } })
    .jpeg()
    .toBuffer();
const fakeMp4 = (size = 300_000) => {
  const head = Buffer.from("0000001866747970697 36f6d0000020069736f6d6d703431".replace(/ /g, ""), "hex");
  return Buffer.concat([head, Buffer.alloc(size, 7)]);
};
const upload = (buf, name, type, fields = {}) => {
  const f = new FormData();
  f.append("file", new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

async function signup(name, email) {
  const c = client(srv.base);
  const r = await c.call("POST", "/api/auth/register", { json: { name, email, password: "Passw0rd!x" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  users[name] = { c, token: r.data.accessToken, id: r.data.user._id, call: (m, u, o = {}) => c.call(m, u, { token: users[name].token, ...o }) };
  return users[name];
}

before(async () => {
  srv = await startServer();
  await signup("Alice", "alice@example.com");
  await signup("Bob", "bob@example.com");
  await signup("Carol", "carol@example.com");
  await signup("Mallory", "mallory@example.com");
});
after(async () => srv.stop());

describe("auth", () => {
  it("rejects weak passwords and bad emails", async () => {
    const c = client(srv.base);
    assert.equal((await c.call("POST", "/api/auth/register", { json: { name: "X Y", email: "x@y.com", password: "short" } })).status, 400);
    assert.equal((await c.call("POST", "/api/auth/register", { json: { name: "X Y", email: "nope", password: "Passw0rd!x" } })).status, 400);
    assert.equal((await c.call("POST", "/api/auth/register", { json: { name: "X Y", email: "x@y.com", password: "onlyletters" } })).status, 400);
  });
  it("never leaks password hashes and refuses duplicate emails", async () => {
    const c = client(srv.base);
    const dup = await c.call("POST", "/api/auth/register", { json: { name: "Alice 2", email: "ALICE@example.com", password: "Passw0rd!x" } });
    assert.equal(dup.status, 409);
    const me = await users.Alice.call("GET", "/api/auth/me");
    assert.equal(me.data.user.password, undefined);
  });
  it("login: wrong password -> 401, right password -> token", async () => {
    const c = client(srv.base);
    assert.equal((await c.call("POST", "/api/auth/login", { json: { email: "alice@example.com", password: "wrong-pass1" } })).status, 401);
    const ok = await c.call("POST", "/api/auth/login", { json: { email: "alice@example.com", password: "Passw0rd!x" } });
    assert.equal(ok.status, 200);
    assert.ok(ok.data.accessToken);
  });
  it("API requires a valid token; forged tokens are rejected", async () => {
    const c = client(srv.base);
    assert.equal((await c.call("GET", "/api/chats")).status, 401);
    assert.equal((await c.call("GET", "/api/chats", { token: "garbage" })).status, 401);
    // the old app signed tokens with the hardcoded secret "dilip@111"
    const jwt = (await import("jsonwebtoken")).default;
    const forged = jwt.sign({ id: users.Alice.id }, "dilip@111");
    assert.equal((await c.call("GET", "/api/chats", { token: forged })).status, 401);
  });
  it("refresh rotates the cookie, and replaying an old refresh token kills the session", async () => {
    const c = client(srv.base);
    await c.call("POST", "/api/auth/login", { json: { email: "bob@example.com", password: "Passw0rd!x" } });
    const oldCookie = c.jar.talk_rt;
    const r1 = await c.call("POST", "/api/auth/refresh");
    assert.equal(r1.status, 200);
    assert.notEqual(c.jar.talk_rt, oldCookie);
    const rotated = c.jar.talk_rt;
    c.jar.talk_rt = oldCookie; // attacker replays the stolen, already-used token
    assert.equal((await c.call("POST", "/api/auth/refresh")).status, 401);
    c.jar.talk_rt = rotated; // the legitimate new token is now dead too (family revoked)
    assert.equal((await c.call("POST", "/api/auth/refresh")).status, 401);
  });
});

describe("users", () => {
  it("search by name prefix & exact email, with masked emails", async () => {
    const byName = await users.Alice.call("GET", "/api/users/search?q=bo");
    assert.equal(byName.status, 200);
    assert.equal(byName.data[0].name, "Bob");
    assert.match(byName.data[0].email, /^b\*\*\*@/);
    const byEmail = await users.Alice.call("GET", "/api/users/search?q=carol@example.com");
    assert.equal(byEmail.data[0].name, "Carol");
    assert.equal((await users.Alice.call("GET", "/api/users/search?q=example")).data.length, 0); // no email-prefix harvesting
    assert.equal((await users.Alice.call("GET", "/api/users/search?q=a")).status, 400);
    assert.equal((await users.Alice.call("GET", "/api/users/search?q=.*")).data.length, 0); // regex is escaped
  });
});

let dm;
describe("chats & messages", () => {
  it("opens a direct chat once, even when requested concurrently", async () => {
    const [a, b, c] = await Promise.all([
      users.Alice.call("POST", "/api/chats/direct", { json: { userId: users.Bob.id } }),
      users.Alice.call("POST", "/api/chats/direct", { json: { userId: users.Bob.id } }),
      users.Bob.call("POST", "/api/chats/direct", { json: { userId: users.Alice.id } }),
    ]);
    assert.equal(a.data._id, b.data._id);
    assert.equal(a.data._id, c.data._id);
    dm = a.data._id;
  });
  it("blocks outsiders from reading, sending to, or marking-read someone else's chat", async () => {
    assert.equal((await users.Mallory.call("GET", `/api/chats/${dm}/messages`)).status, 404);
    assert.equal((await users.Mallory.call("POST", `/api/chats/${dm}/messages`, { json: { text: "hi" } })).status, 404);
    assert.equal((await users.Mallory.call("POST", `/api/chats/${dm}/read`)).status, 404);
    assert.equal((await users.Mallory.call("GET", `/api/chats/${dm}`)).status, 404);
  });
  it("sends text, trims, rejects empty, dedupes by clientId", async () => {
    const r = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { json: { text: "  hello <b>bob</b>  ", clientId: "cid-0001" } });
    assert.equal(r.status, 201);
    assert.equal(r.data.message.text, "hello <b>bob</b>"); // stored as plain text; React escapes on render
    const again = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { json: { text: "hello <b>bob</b>", clientId: "cid-0001" } });
    assert.equal(again.status, 200);
    assert.equal(again.data.message._id, r.data.message._id);
    assert.equal((await users.Alice.call("POST", `/api/chats/${dm}/messages`, { json: { text: "   " } })).status, 400);
    assert.equal((await users.Alice.call("POST", `/api/chats/${dm}/messages`, { json: { text: "x".repeat(4001) } })).status, 400);
  });
  it("cursor-paginates history", async () => {
    for (let i = 0; i < 12; i++) await users.Bob.call("POST", `/api/chats/${dm}/messages`, { json: { text: `msg ${i}` } });
    const p1 = await users.Alice.call("GET", `/api/chats/${dm}/messages?limit=5`);
    assert.equal(p1.data.messages.length, 5);
    assert.equal(p1.data.hasMore, true);
    assert.equal(p1.data.messages.at(-1).text, "msg 11");
    const p2 = await users.Alice.call("GET", `/api/chats/${dm}/messages?limit=50&before=${p1.data.messages[0]._id}`);
    assert.equal(p2.data.messages.length, 8); // 7 older bob msgs + alice's first
    assert.equal(p2.data.hasMore, false);
  });
  it("tracks unread counts and read receipts", async () => {
    const list = await users.Alice.call("GET", "/api/chats");
    assert.equal(list.data.find((c) => c._id === dm).unread, 12);
    const r = await users.Alice.call("POST", `/api/chats/${dm}/read`);
    assert.equal(r.status, 200);
    assert.equal((await users.Alice.call("GET", "/api/chats")).data.find((c) => c._id === dm).unread, 0);
    const msgs = await users.Bob.call("GET", `/api/chats/${dm}/messages?limit=50`);
    const bobs = msgs.data.messages.filter((m) => m.text.startsWith("msg "));
    assert.equal(bobs.length, 12);
    assert.ok(bobs.every((m) => m.readBy.includes(users.Alice.id)), "Alice read all of Bob's messages");
    const alices = msgs.data.messages.find((m) => m.text.startsWith("hello"));
    assert.ok(!alices.readBy.includes(users.Bob.id), "Bob has not read Alice's yet");
  });
  it("validates ids instead of crashing on garbage", async () => {
    assert.equal((await users.Alice.call("GET", "/api/chats/not-an-id/messages")).status, 400);
    assert.equal((await users.Alice.call("DELETE", "/api/messages/123")).status, 400);
  });
  it("supports built-in stickers", async () => {
    const r = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { json: { kind: "sticker", stickerPack: "classic", stickerId: "party" } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.data.message.sticker, { pack: "classic", id: "party" });
  });
});

describe("media", () => {
  it("accepts an image, strips EXIF, re-encodes to WebP, and serves it only with a valid grant", async () => {
    const r = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await jpegWithExif(), "../../evil.jpg", "image/jpeg", { text: "look" }) });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const m = r.data.message;
    assert.equal(m.kind, "image");
    assert.equal(m.text, "look");
    assert.equal(m.media.key, undefined, "storage key must never reach clients");
    assert.match(m.media.url, /^\/api\/media\//);
    const bytes = await fetch(srv.base + m.media.url);
    assert.equal(bytes.status, 200);
    assert.equal(bytes.headers.get("content-type"), "image/webp");
    assert.equal(bytes.headers.get("x-content-type-options"), "nosniff");
    const buf = Buffer.from(await bytes.arrayBuffer());
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined, "EXIF must be stripped");
    assert.ok(!buf.toString("latin1").includes("SECRET-GPS-OWNER"));
    // No token / wrong message / garbage token
    assert.equal((await fetch(srv.base + `/api/media/${m._id}`)).status, 401);
    assert.equal((await fetch(srv.base + `/api/media/${m._id}?t=abc`)).status, 401);
    const other = (await users.Bob.call("POST", `/api/messages/${m._id}/view`)).data.url;
    const otherId = (await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await png(), "a.png", "image/png") })).data.message._id;
    assert.equal((await fetch(srv.base + `/api/media/${otherId}?t=${new URL(srv.base + other).searchParams.get("t")}`)).status, 403, "token is bound to one message");
  });
  it("rejects files that lie about their type, or aren't media", async () => {
    const fake = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(Buffer.from("<script>alert(1)</script>"), "x.png", "image/png") });
    assert.equal(fake.status, 400);
    const exe = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(Buffer.from("MZ\x90\x00\x03"), "a.jpg", "image/jpeg") });
    assert.equal(exe.status, 400);
    const svg = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), "a.svg", "image/svg+xml") });
    assert.equal(svg.status, 400);
  });
  it("enforces size limits", async () => {
    const big = await sharp({ create: { width: 3000, height: 3000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
    assert.ok(big.length > 10 * 1024 * 1024, "fixture should exceed the 10MB image limit, got " + big.length);
    const r = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(big, "big.png", "image/png") });
    assert.ok([400, 413].includes(r.status), "got " + r.status);
  });
  it("accepts GIFs and videos, and serves video with HTTP Range", async () => {
    const gifBuf = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#0000ff" } }).gif().toBuffer();
    const g = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(gifBuf, "a.gif", "image/gif") });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    assert.equal(g.data.message.kind, "gif");
    const v = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(fakeMp4(), "clip.mp4", "video/mp4") });
    assert.equal(v.status, 201, JSON.stringify(v.data));
    assert.equal(v.data.message.kind, "video");
    const full = await fetch(srv.base + v.data.message.media.url);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal((await full.arrayBuffer()).byteLength, 300_000 + 24);
    const part = await fetch(srv.base + v.data.message.media.url, { headers: { range: "bytes=100-199" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 100-199/300024");
    assert.equal((await part.arrayBuffer()).byteLength, 100);
    const bad = await fetch(srv.base + v.data.message.media.url, { headers: { range: "bytes=999999999-" } });
    assert.equal(bad.status, 416);
  });
  it("accepts custom stickers (transparent PNG -> WebP)", async () => {
    const s = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await png(), "s.png", "image/png", { kind: "sticker" }) });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    assert.equal(s.data.message.kind, "sticker");
  });
});

describe("view once / view twice", () => {
  let once, twice;
  it("recipient gets a locked card with no URL; sender sees status only", async () => {
    const r = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await png("#123456"), "p.png", "image/png", { viewPolicy: "once" }) });
    assert.equal(r.status, 201);
    once = r.data.message._id;
    assert.equal(r.data.message.media.url, undefined);
    assert.deepEqual(r.data.message.media.openedBy, []);
    const asBob = (await users.Bob.call("GET", `/api/chats/${dm}/messages?limit=50`)).data.messages.find((m) => m._id === once);
    assert.equal(asBob.media.viewPolicy, "once");
    assert.equal(asBob.media.viewsLeft, 1);
    assert.equal(asBob.media.url, undefined);
  });
  it("sender cannot re-open their own view-once media", async () => {
    assert.equal((await users.Alice.call("POST", `/api/messages/${once}/view`)).status, 403);
  });
  it("outsiders can't get a view", async () => {
    assert.equal((await users.Mallory.call("POST", `/api/messages/${once}/view`)).status, 404);
  });
  it("allows exactly one view of view-once media", async () => {
    const first = await users.Bob.call("POST", `/api/messages/${once}/view`);
    assert.equal(first.status, 200);
    assert.equal(first.data.viewsLeft, 0);
    const bytes = await fetch(srv.base + first.data.url);
    assert.equal(bytes.status, 200);
    assert.equal(bytes.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal((await users.Bob.call("POST", `/api/messages/${once}/view`)).status, 403);
    assert.equal((await users.Bob.call("POST", `/api/messages/${once}/view`)).status, 403);
    const asAlice = (await users.Alice.call("GET", `/api/chats/${dm}/messages?limit=50`)).data.messages.find((m) => m._id === once);
    assert.deepEqual(asAlice.media.openedBy, [users.Bob.id]);
    const asBob = (await users.Bob.call("GET", `/api/chats/${dm}/messages?limit=50`)).data.messages.find((m) => m._id === once);
    assert.equal(asBob.media.viewsLeft, 0);
    assert.equal(asBob.media.url, undefined);
  });
  it("view-twice allows exactly two views", async () => {
    const r = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await png("#654321"), "q.png", "image/png", { viewPolicy: "twice" }) });
    twice = r.data.message._id;
    const a = await users.Bob.call("POST", `/api/messages/${twice}/view`);
    const b = await users.Bob.call("POST", `/api/messages/${twice}/view`);
    const c = await users.Bob.call("POST", `/api/messages/${twice}/view`);
    assert.deepEqual([a.status, b.status, c.status], [200, 200, 403]);
    assert.deepEqual([a.data.viewsLeft, b.data.viewsLeft], [1, 0]);
  });
  it("concurrent requests can't exceed the view limit (needs real MongoDB atomicity)", async (t) => {
    if (!(await isRealMongo())) return t.skip("DB stand-in (FerretDB) doesn't give atomic filtered updates; run against MongoDB to exercise this");
    const mk = async (policy) => (await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await png("#0a0a0a"), "c.png", "image/png", { viewPolicy: policy }) })).data.message._id;
    const [o, tw] = [await mk("once"), await mk("twice")];
    const ro = await Promise.all(Array.from({ length: 8 }, () => users.Bob.call("POST", `/api/messages/${o}/view`)));
    const rt = await Promise.all(Array.from({ length: 8 }, () => users.Bob.call("POST", `/api/messages/${tw}/view`)));
    assert.equal(ro.filter((r) => r.status === 200).length, 1);
    assert.equal(rt.filter((r) => r.status === 200).length, 2);
  });
  it("the file is shredded after everyone used their views, and the link dies", async () => {
    const { purgeExhaustedMedia } = await import("../src/jobs/purge.js");
    const { Message } = await import("../src/models/Message.js");
    const before = await Message.findById(once).lean();
    assert.ok(before.media.exhaustedAt, "exhaustedAt set when the only recipient finished");
    assert.ok(before.media.key);
    const n = await purgeExhaustedMedia();
    assert.ok(n >= 1);
    const after = await Message.findById(once).lean();
    assert.equal(after.media.key, null);
    assert.ok(after.media.purgedAt);
    const asBob = (await users.Bob.call("GET", `/api/chats/${dm}/messages?limit=50`)).data.messages.find((m) => m._id === once);
    assert.equal(asBob.media.purged, true);
  });
  it("view-once is per-recipient in groups", async () => {
    const g = await users.Alice.call("POST", "/api/chats/group", { json: { name: "Trio", userIds: [users.Bob.id, users.Carol.id] } });
    assert.equal(g.status, 201);
    const gid = g.data._id;
    const m = (await users.Alice.call("POST", `/api/chats/${gid}/messages`, { form: upload(await png("#abcdef"), "g.png", "image/png", { viewPolicy: "once" }) })).data.message;
    assert.equal((await users.Bob.call("POST", `/api/messages/${m._id}/view`)).status, 200);
    assert.equal((await users.Bob.call("POST", `/api/messages/${m._id}/view`)).status, 403);
    assert.equal((await users.Carol.call("POST", `/api/messages/${m._id}/view`)).status, 200, "Carol still has her own view");
    const { Message } = await import("../src/models/Message.js");
    assert.ok((await Message.findById(m._id).lean()).media.exhaustedAt);
  });
});

describe("delete for everyone", () => {
  it("only the sender can delete; media is removed from disk", async () => {
    const m = (await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await png("#222222"), "d.png", "image/png") })).data.message;
    assert.equal((await users.Bob.call("DELETE", `/api/messages/${m._id}`)).status, 403);
    assert.equal((await users.Mallory.call("DELETE", `/api/messages/${m._id}`)).status, 404);
    const url = m.media.url;
    assert.equal((await fetch(srv.base + url)).status, 200);
    assert.equal((await users.Alice.call("DELETE", `/api/messages/${m._id}`)).status, 200);
    assert.equal((await fetch(srv.base + url)).status, 404);
    const asBob = (await users.Bob.call("GET", `/api/chats/${dm}/messages?limit=50`)).data.messages.find((x) => x._id === m._id);
    assert.equal(asBob.deleted, true);
    assert.equal(asBob.media, undefined);
  });
});

describe("groups", () => {
  let gid;
  it("needs 2+ other members; creator is admin", async () => {
    assert.equal((await users.Alice.call("POST", "/api/chats/group", { json: { name: "Duo", userIds: [users.Bob.id] } })).status, 400);
    const g = await users.Alice.call("POST", "/api/chats/group", { json: { name: "Team", userIds: [users.Bob.id, users.Carol.id] } });
    gid = g.data._id;
    assert.equal(g.data.members.find((m) => m.user._id === users.Alice.id).role, "admin");
    assert.equal(g.data.members[0].user.email, undefined);
  });
  it("only admins can rename/add/remove", async () => {
    assert.equal((await users.Bob.call("PATCH", `/api/chats/${gid}`, { json: { name: "Hacked" } })).status, 403);
    assert.equal((await users.Bob.call("POST", `/api/chats/${gid}/members`, { json: { userIds: [users.Mallory.id] } })).status, 403);
    assert.equal((await users.Bob.call("DELETE", `/api/chats/${gid}/members/${users.Carol.id}`)).status, 403);
    assert.equal((await users.Alice.call("PATCH", `/api/chats/${gid}`, { json: { name: "Renamed" } })).data.name, "Renamed");
    const added = await users.Alice.call("POST", `/api/chats/${gid}/members`, { json: { userIds: [users.Mallory.id] } });
    assert.equal(added.data.members.length, 4);
  });
  it("removed members lose access; admin leaving promotes someone", async () => {
    assert.equal((await users.Alice.call("DELETE", `/api/chats/${gid}/members/${users.Mallory.id}`)).status, 200);
    assert.equal((await users.Mallory.call("GET", `/api/chats/${gid}/messages`)).status, 404);
    assert.equal((await users.Alice.call("DELETE", `/api/chats/${gid}/members/${users.Alice.id}`)).status, 200);
    const chat = (await users.Bob.call("GET", `/api/chats/${gid}`)).data;
    assert.ok(chat.members.some((m) => m.role === "admin"), "a new admin was promoted");
  });
});

describe("blocking", () => {
  it("blocked users cannot message, and can't be re-opened by the blocked side", async () => {
    const d = (await users.Carol.call("POST", "/api/chats/direct", { json: { userId: users.Mallory.id } })).data._id;
    assert.equal((await users.Mallory.call("POST", `/api/chats/${d}/messages`, { json: { text: "hi" } })).status, 201);
    assert.equal((await users.Carol.call("POST", `/api/users/${users.Mallory.id}/block`)).status, 200);
    assert.equal((await users.Mallory.call("POST", `/api/chats/${d}/messages`, { json: { text: "hello?" } })).status, 403);
    assert.equal((await users.Carol.call("POST", `/api/chats/${d}/messages`, { json: { text: "hey" } })).status, 403);
    assert.equal((await users.Mallory.call("POST", "/api/chats/direct", { json: { userId: users.Carol.id } })).status, 403);
    await users.Carol.call("DELETE", `/api/users/${users.Mallory.id}/block`);
    assert.equal((await users.Mallory.call("POST", `/api/chats/${d}/messages`, { json: { text: "back" } })).status, 201);
  });
});

describe("realtime", () => {
  const connect = (token) =>
    new Promise((resolve, reject) => {
      const s = ioc(srv.base, { auth: { token }, transports: ["websocket"], reconnection: false });
      s.on("connect_error", reject);
      s.once("presence:snapshot", () => resolve(s)); // server finished per-connection setup
    });
  const once = (s, ev, ms = 10000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout " + ev)), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });

  it("rejects unauthenticated sockets", async () => {
    await assert.rejects(connect("nope"), /unauthorized/);
  });
  it("delivers messages to members only, with viewer-specific payloads, and presence", async () => {
    const bob = await connect(users.Bob.token);
    const mallory = await connect(users.Mallory.token);
    let leaked = false;
    mallory.on("message:new", () => (leaked = true));
    mallory.on("typing", () => (leaked = true));

    const got = once(bob, "message:new");
    const typing = once(bob, "typing");
    const alice = await connect(users.Alice.token);
    alice.emit("typing:start", { chatId: dm });
    mallory.emit("typing:start", { chatId: dm }); // not a member: must be ignored
    const t = await typing;
    assert.equal(t.userId, users.Alice.id);

    const r = await users.Alice.call("POST", `/api/chats/${dm}/messages`, { form: upload(await png("#777777"), "r.png", "image/png", { viewPolicy: "once" }) });
    assert.equal(r.status, 201, "send failed: " + JSON.stringify(r.data));
    const ev = await got;
    assert.equal(ev.message._id, r.data.message._id);
    assert.equal(ev.message.media.viewsLeft, 1, "Bob sees a recipient-view of the message");
    assert.equal(ev.message.media.url, undefined);
    assert.equal(ev.chat.unread >= 1, true);

    const updated = once(alice, "message:updated");
    await users.Bob.call("POST", `/api/messages/${r.data.message._id}/view`);
    const upd = await updated;
    assert.deepEqual(upd.message.media.openedBy, [users.Bob.id], "sender is told the media was opened");

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(leaked, false, "non-members receive nothing");
    [bob, mallory, alice].forEach((s) => s.close());
  });
});
