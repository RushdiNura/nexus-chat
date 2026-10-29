import mongoose from "mongoose";
const groupMessageSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  text: { type: String, trim: true, maxlength: 10000, default: "" },
  image: { type: String, default: "" },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage", default: null, index: true },
  forwardedFrom: {
    senderName: { type: String, maxlength: 120, default: "" },
    groupName: { type: String, maxlength: 80, default: "" },
  },
  clientMessageId: { type: String, maxlength: 100 },
  editedAt: Date,
  deletedForEveryone: { type: Boolean, default: false },
  readBy: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, readAt: { type: Date, default: Date.now } }],
  reactions: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, emoji: { type: String, enum: ["👍", "❤️", "😂", "😮", "😢", "🔥"], required: true }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true });
groupMessageSchema.index({ groupId: 1, createdAt: -1 });
groupMessageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } });
export default mongoose.model("GroupMessage", groupMessageSchema);
