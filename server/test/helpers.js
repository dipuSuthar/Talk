// Must run before any app module is imported (env is validated on import).
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.NODE_ENV = "test";
process.env.MONGO_URL ??= "mongodb://127.0.0.1:27017/talk_test_" + Date.now();
process.env.JWT_ACCESS_SECRET = "a".repeat(48);
process.env.JWT_MEDIA_SECRET = "b".repeat(48);
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talk-test-"));
process.env.PURGE_AFTER_MINUTES = "0";

const { createApp } = await import("../src/app.js");
const { attachSockets } = await import("../src/sockets/index.js");
const { connectDB, disconnectDB } = await import("../src/config/db.js");
const { initStorage } = await import("../src/lib/storage.js");
const mongoose = (await import("mongoose")).default;
const http = await import("node:http");

/** The local FerretDB stand-in doesn't make filtered updates atomic; real MongoDB does. */
export async function isRealMongo() {
  const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
  return !("ferretdbVersion" in info) && !/ferret/i.test(JSON.stringify(info));
}

export async function startServer() {
  await initStorage();
  await connectDB();
  await mongoose.connection.dropDatabase();
  // dropDatabase also drops the indexes Mongoose built on connect; rebuild them like production boot does.
  // The local FerretDB stand-in lacks TTL indexes (RefreshToken); real MongoDB has them. Tolerate that one gap.
  for (const m of Object.values(mongoose.models)) {
    await m.syncIndexes().catch((e) => {
      if (!/expireAfterSeconds/.test(e.message)) throw e;
      return m.createIndexes({ ignoreUndefined: true }).catch(() => {});
    });
  }
  const server = http.createServer(createApp());
  const io = attachSockets(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async stop() {
      io.close();
      await new Promise((r) => server.close(r));
      await mongoose.connection.dropDatabase();
      await disconnectDB();
    },
  };
}

export function client(base) {
  const jar = {};
  const call = async (method, url, { token, json, form, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.cookie = cookie;
    let body;
    if (json !== undefined) {
      h["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) body = form;
    const res = await fetch(base + url, { method, headers: h, body });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const [k, ...v] = pair.split("=");
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) delete jar[k];
      else jar[k] = v.join("=");
    }
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : null;
    return { status: res.status, data, res };
  };
  return { call, jar };
}
