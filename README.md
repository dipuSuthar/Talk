# Talk v2

A rebuilt real-time chat app: **React 19 + Vite + Tailwind 4** on the front, **Express 5 + MongoDB + Socket.IO** on the back.

## Run it

```bash
cp .env.example .env        # then fill JWT_ACCESS_SECRET and JWT_MEDIA_SECRET (command is in the file)
docker compose up --build   # app on http://localhost:8080
```

Without Docker (Node 20.11+ and a MongoDB):

```bash
cd server && cp .env.example .env   # fill secrets + MONGO_URL
npm install && npm run dev          # API on :7000
cd client && npm install && npm run dev   # app on :5173 (proxies /api and websockets to :7000)
```

## What's new

**Chat**: real-time messages, typing indicators, online / last seen, sent and read ticks, unread badges (also in the tab title), delete-for-everyone, groups (admins, add/remove, leave, auto-promote), block users, light/dark theme, mobile layout.

**Media**: photos, GIFs, videos (HTTP Range streaming), upload progress, retry on failure, paste or drag-and-drop, built-in sticker packs + your own PNG/WebP stickers.

**View once / view twice**: choose *Normal*, *View once* or *View twice* before sending. Recipients see a locked card and nothing is downloaded until they tap. Each tap consumes a view on the server, the sender sees "Opened", and the file is deleted from disk shortly after every recipient has used their views.

**Performance**: virtualized message list with cursor pagination (long chats stay smooth), optimistic sends, one indexed query per page, WebP re-encoding, lazy-loaded emoji picker, no media over WebSockets, gzip, immutable asset caching.

## Security (what changed from v1)

| v1 problem | v2 |
|---|---|
| JWT signed with a hardcoded string in source | Secrets come from env; server refuses to boot without them. 15-min access tokens in memory + rotating httpOnly refresh cookie with replay detection |
| Any logged-in user could read any chat | Every chat/message/media route checks membership (non-members get 404) |
| User search returned password hashes | `password` is `select:false`; emails masked; search is by name prefix or exact email only |
| No rate limits / headers | helmet, per-route rate limits (login, register, send, upload), body limits, zod validation on every input |
| Socket events trusted the client | Sockets are authenticated; messages are created server-side only; typing checks membership |
| Uploads trusted the filename/mimetype | Real file type checked from magic bytes, size limits, EXIF/GPS stripped, images re-encoded, random names, private storage never served statically |
| Client-side "encryption" with a key shipped in the JS bundle | Removed. It gave a false sense of security (anyone can read the key). Use HTTPS; see "Not included" |

## Moving your old data

```bash
mongodump --uri "$MONGO_URL"                      # backup first
cd server && LEGACY_SECRET_KEY=<old REACT_APP_SECRET_KEY> MONGO_URL=... npm run migrate:legacy -- --dry-run
LEGACY_SECRET_KEY=... MONGO_URL=... npm run migrate:legacy
```
Run it **before** the first v2 start. It decrypts old messages, merges duplicate 1:1 chats, keeps old Cloudinary media viewable, and old passwords keep working. Undecryptable messages keep their ciphertext so a re-run with the right key recovers them.

## Tests

```bash
cd server && MONGO_URL=mongodb://127.0.0.1:27017/talk_test npm test        # API, auth, uploads, view-once, sockets, migration
MONGO_URL=mongodb://127.0.0.1:27017/talk_e2e node --test e2e/*.test.js              # client stores against a live server (needs server/ and client/ installed)
cd client && npm run lint && npm run build
```

## Honest limits

- **Screenshots can't be blocked by a web app.** View-once is a strong social + server-side control (no re-open, no download link, file deleted), not DRM.
- **Not end-to-end encrypted.** Messages are protected in transit (use HTTPS) and the server can read them. E2EE (e.g. Signal protocol) is a sizeable separate project.
- Single server instance: presence is in memory and media is on local disk (a volume). To scale out, add the Socket.IO Redis adapter and an S3-style storage driver (`server/src/lib/storage.js` is the one file to swap).
- Videos are stored as uploaded (no transcoding / metadata stripping); add ffmpeg if you need that.
- Put HTTPS in front before production and set `COOKIE_SECURE=true`.
- Atomic view counting relies on MongoDB's single-document update atomicity. The concurrent-race test is skipped on non-MongoDB stand-ins.
