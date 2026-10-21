import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { mediaGrantLimiter } from "../middleware/limits.js";
import { oid } from "../lib/util.js";
import * as messages from "../services/messages.js";

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

messagesRouter.delete("/:id", async (req, res) => res.json(await messages.deleteMessage(oid(req.params.id), req.userId)));

// Consumes a view (for once/twice media) and returns a short-lived media URL.
messagesRouter.post("/:id/view", mediaGrantLimiter, async (req, res) => res.json(await messages.grantMediaView(oid(req.params.id), req.userId)));
