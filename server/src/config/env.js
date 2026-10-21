import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(7000),
  MONGO_URL: z.string().min(1, "MONGO_URL is required"),
  // Secrets must be long & random. The server refuses to boot without them.
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be >= 32 chars"),
  JWT_MEDIA_SECRET: z.string().min(32, "JWT_MEDIA_SECRET must be >= 32 chars"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().default(30),
  // Comma separated list of allowed browser origins (only needed if the
  // client is served from a different origin than the API).
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: z.coerce.number().int().default(0),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  MAX_IMAGE_MB: z.coerce.number().default(10),
  MAX_GIF_MB: z.coerce.number().default(15),
  MAX_VIDEO_MB: z.coerce.number().default(50),
  // How long an exhausted view-once/twice file is kept before being shredded.
  PURGE_AFTER_MINUTES: z.coerce.number().default(15),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${lines.join("\n")}`);
  process.exit(1);
}

export const env = parsed.data;
export const clientOrigins = env.CLIENT_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
export const isProd = env.NODE_ENV === "production";
