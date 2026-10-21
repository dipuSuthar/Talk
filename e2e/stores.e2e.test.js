
import { startServer, client } from "../server/test/helpers.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const clientRequire = createRequire(new URL("../client/package.json", import.meta.url));
const { io } = await import(clientRequire.resolve("socket.io-client"));
const sharp = (await import(createRequire(new URL("../server/package.json", import.meta.url)).resolve("sharp"))).default;

let srv, api, getToken, useAuth, useChat, alice, bob, aliceSocket, bobSocket, chatId;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000, label = "condition") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(25); }
  throw new Error("timed out waiting for " + label);
};
const msgs = () => useChat.getState().messages[chatId]?.items ?? [];
const png = (c) => sharp({ create: { width: 40, height: 30, channels: 3, background: c } }).png().toBuffer();

before(async () => {
  srv = await startServer();
  ({ api, getToken } = await import("../client/src/lib/api.js"));
  api.defaults.baseURL = srv.base + "/api";
  ({ useAuth } = await import("../client/src/store/auth.js"));
  ({ useChat } = await import("../client/src/store/chat.js"));
  // Minimal browser globals the stores touch at event time. Defined AFTER axios is imported so it
  // keeps using its Node (http) adapter instead of the browser XHR one.
  globalThis.window = globalThis;
  globalThis.dispatchEvent = () => true;
  globalThis.document = { visibilityState: "visible" };

  await useAuth.getState().register("Alice Tester", "alice@e2e.com", "Passw0rd!x");
  alice = useAuth.getState().user;

  const c = client(srv.base);
  const r = await c.call("POST", "/api/auth/register", { json: { name: "Bob Tester", email: "bob@e2e.com", password: "Passw0rd!x" } });
  bob = { id: r.data.user._id, token: r.data.accessToken, call: (m, u, o = {}) => c.call(m, u, { token: r.data.accessToken, ...o }) };

  // Alice's real socket + the store's real event handlers
  aliceSocket = io(srv.base, { auth: { token: getToken() }, transports: ["websocket"] });
  for (const [ev, fn] of Object.entries(useChat.getState().handlers)) aliceSocket.on(ev, fn);
  await new Promise((res) => aliceSocket.once("presence:snapshot", res));
  bobSocket = io(srv.base, { auth: { token: bob.token }, transports: ["websocket"] });
  await new Promise((res) => bobSocket.once("presence:snapshot", res));
});
after(async () => { aliceSocket?.close(); bobSocket?.close(); await srv.stop(); });

describe("client stores vs real server", () => {
  it("a chat started by someone else appears with an unread badge (unknown chat is fetched)", async () => {
    const dm = await bob.call("POST", "/api/chats/direct", { json: { userId: alice._id } });
    chatId = dm.data._id;
    await bob.call("POST", `/api/chats/${chatId}/messages`, { json: { text: "hey Alice" } });
    const chat = await until(() => useChat.getState().chats.find((c) => c._id === chatId), 4000, "chat to appear");
    await until(() => useChat.getState().chats.find((c) => c._id === chatId)?.unread === 1, 3000, "unread=1");
    assert.equal(chat.type, "direct");
  });

  it("opening the chat loads history and marks it read (Bob sees the receipt)", async () => {
    useChat.getState().setActive(chatId);
    await until(() => msgs().length === 1, 3000, "history");
    await until(() => useChat.getState().chats.find((c) => c._id === chatId).unread === 0, 3000, "unread cleared");
    // the store clears the badge optimistically; the receipt lands on the server a moment later
    let list;
    for (let i = 0; i < 40; i++) {
      list = (await bob.call("GET", `/api/chats/${chatId}/messages`)).data.messages;
      if (list[0].readBy.includes(alice._id)) break;
      await wait(50);
    }
    assert.ok(list[0].readBy.includes(alice._id), "Bob's message shows as read by Alice");
  });

  it("optimistic text send: shows instantly, then exactly ONE confirmed copy (socket echo is de-duplicated)", async () => {
    const p = useChat.getState().sendText(chatId, "hello Bob");
    assert.equal(msgs().at(-1).status, "sending", "optimistic bubble is present immediately");
    await p;
    await wait(200); // let the socket echo arrive
    const mine = msgs().filter((m) => m.text === "hello Bob");
    assert.equal(mine.length, 1, "no duplicate after the echo");
    assert.equal(mine[0].status, undefined);
    assert.ok(!String(mine[0]._id).startsWith("tmp-"), "temp id replaced by the server id");
  });

  it("read receipts arrive in real time when Bob reads", async () => {
    await bob.call("POST", `/api/chats/${chatId}/read`);
    await until(() => msgs().find((m) => m.text === "hello Bob")?.readBy.includes(bob.id), 3000, "read receipt");
  });

  it("typing indicator turns on and off", async () => {
    bobSocket.emit("typing:start", { chatId });
    await until(() => useChat.getState().typing[chatId]?.[bob.id], 3000, "typing on");
    bobSocket.emit("typing:stop", { chatId });
    await until(() => !useChat.getState().typing[chatId]?.[bob.id], 3000, "typing off");
  });

  it("incoming messages while the chat is open are appended and auto-marked read", async () => {
    await bob.call("POST", `/api/chats/${chatId}/messages`, { json: { text: "live message" } });
    await until(() => msgs().some((m) => m.text === "live message"), 3000, "live message");
    await until(() => useChat.getState().chats.find((c) => c._id === chatId).unread === 0, 3000, "still unread=0");
  });

  it("sends a normal photo with upload, replaces the optimistic bubble, and gets a working URL", async () => {
    const file = new File([await png("#ff8800")], "p.png", { type: "image/png" });
    await useChat.getState().sendMedia(chatId, file, { text: "caption" });
    await wait(200);
    const m = msgs().find((x) => x.text === "caption");
    assert.equal(msgs().filter((x) => x.text === "caption").length, 1);
    assert.equal(m.kind, "image");
    assert.equal(m.status, undefined);
    const res = await fetch(srv.base + m.media.url);
    assert.equal(res.status, 200);
  });

  it("view-once sent by Alice: Alice sees status only; when Bob opens it, her store updates to 'opened'", async () => {
    const file = new File([await png("#112233")], "o.png", { type: "image/png" });
    await useChat.getState().sendMedia(chatId, file, { viewPolicy: "once" });
    await wait(150);
    const m = msgs().find((x) => x.media?.viewPolicy === "once" && !x.media.local);
    assert.ok(m, "confirmed view-once message present");
    assert.equal(m.media.url, undefined);
    assert.deepEqual(m.media.openedBy, []);
    assert.equal((await bob.call("POST", `/api/messages/${m._id}/view`)).status, 200);
    await until(() => msgs().find((x) => x._id === m._id).media.openedBy?.includes(bob.id), 3000, "opened status");
    assert.equal((await bob.call("POST", `/api/messages/${m._id}/view`)).status, 403);
  });

  it("view-once received by Alice: locked card, one view via the same API the viewer uses, then locked out", async () => {
    const f = new FormData();
    f.append("file", new Blob([await png("#445566")], { type: "image/png" }), "x.png");
    f.append("viewPolicy", "once");
    const sent = await bob.call("POST", `/api/chats/${chatId}/messages`, { form: f });
    const id = sent.data.message._id;
    const card = await until(() => msgs().find((m) => m._id === id), 3000, "locked card");
    assert.equal(card.media.viewsLeft, 1);
    assert.equal(card.media.url, undefined, "no media link until the recipient opens it");
    const grant = await api.post(`/messages/${id}/view`);
    assert.equal(grant.data.viewsLeft, 0);
    assert.equal((await fetch(srv.base + grant.data.url)).status, 200);
    await until(() => msgs().find((m) => m._id === id).media.viewsLeft === 0, 3000, "card updated to opened");
    await assert.rejects(api.post(`/messages/${id}/view`), (e) => e.response?.status === 403);
  });

  it("a failed send is marked failed (with the server's reason) and can be discarded", async () => {
    await bob.call("POST", `/api/users/${alice._id}/block`);
    await useChat.getState().sendText(chatId, "will fail");
    const m = msgs().find((x) => x.text === "will fail");
    assert.equal(m.status, "failed");
    assert.match(m.error, /blocked|can't message/i);
    useChat.getState().discard(chatId, m.clientId);
    assert.ok(!msgs().some((x) => x.text === "will fail"));
    await bob.call("DELETE", `/api/users/${alice._id}/block`);
  });

  it("delete-for-everyone by Bob is reflected live and clears the chat preview", async () => {
    const sent = (await bob.call("POST", `/api/chats/${chatId}/messages`, { json: { text: "oops wrong chat" } })).data.message;
    await until(() => msgs().some((m) => m._id === sent._id), 3000, "message arrives");
    await bob.call("DELETE", `/api/messages/${sent._id}`);
    await until(() => msgs().find((m) => m._id === sent._id)?.deleted, 3000, "deleted flag");
    assert.equal(msgs().find((m) => m._id === sent._id).text, "");
    assert.equal(useChat.getState().chats.find((c) => c._id === chatId).lastMessage.kind, "deleted");
  });

  it("infinite scroll: loads older pages without duplicates, keeps order, and shifts firstItemIndex by exactly what was prepended", async () => {
    for (let i = 0; i < 60; i++) await bob.call("POST", `/api/chats/${chatId}/messages`, { json: { text: `bulk ${i}` } });
    await useChat.getState().loadLatest(chatId); // fresh window: latest 30
    const b0 = useChat.getState().messages[chatId];
    assert.equal(b0.items.length, 30);
    assert.equal(b0.hasMore, true);
    const first0 = b0.first;
    await useChat.getState().loadOlder(chatId);
    const b1 = useChat.getState().messages[chatId];
    assert.equal(b1.items.length, 60);
    assert.equal(b1.first, first0 - 30, "firstItemIndex decreased by the number prepended (Virtuoso keeps scroll position)");
    await useChat.getState().loadOlder(chatId);
    const all = useChat.getState().messages[chatId];
    const ids = all.items.map((m) => m._id);
    assert.equal(new Set(ids).size, ids.length, "no duplicate messages");
    const times = all.items.map((m) => new Date(m.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b), "chronological order");
    assert.equal(all.first, first0 - (all.items.length - 30));
    // keep going until the start of the conversation
    for (let i = 0; i < 5 && useChat.getState().messages[chatId].hasMore; i++) await useChat.getState().loadOlder(chatId);
    const end = useChat.getState().messages[chatId];
    assert.equal(end.hasMore, false);
    assert.equal(end.items[0].text, "hey Alice", "reached the very first message");
  });

  it("presence: Bob going offline updates Alice's store", async () => {
    assert.ok(useChat.getState().online[bob.id], "Bob shows online");
    bobSocket.close();
    await until(() => !useChat.getState().online[bob.id], 4000, "bob offline");
  });
});
