import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../lib/logger.js";

export async function connectDB() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URL, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 8000,
  });
  logger.info("MongoDB connected");
}
export const disconnectDB = () => mongoose.disconnect();
