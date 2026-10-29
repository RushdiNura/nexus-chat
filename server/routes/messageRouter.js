import express from "express";
import { verifyUser } from "../middleware/auth.js";
import {
  getMessageAsSeen,
  getMessages,
  getUsersForSidebar,
  sendMessage,
  editMessage,
  deleteMessage,
  toggleMessageReaction,
  forwardMessage,
  getPinnedMessages,
  togglePinnedMessage,
} from "../controllers/messageController.js";

const messageRoute = express.Router();

// Specific routes are kept above the generic /:id route for clarity and to avoid
// accidental route capture as the API grows.
messageRoute.get("/users", verifyUser, getUsersForSidebar);
messageRoute.get("/pinned/:id", verifyUser, getPinnedMessages);
messageRoute.get("/:id", verifyUser, getMessages);
messageRoute.put("/mark/:id", verifyUser, getMessageAsSeen);
messageRoute.post("/send/:id", verifyUser, sendMessage);
messageRoute.patch("/:id", verifyUser, editMessage);
messageRoute.delete("/:id", verifyUser, deleteMessage);
messageRoute.post("/:id/reactions", verifyUser, toggleMessageReaction);
messageRoute.post("/:id/forward", verifyUser, forwardMessage);
messageRoute.patch("/:id/pin", verifyUser, togglePinnedMessage);

export default messageRoute;
