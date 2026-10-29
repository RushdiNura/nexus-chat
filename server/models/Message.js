import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  text: { type: String, trim: true, maxlength: 10000, default: "" },
  image: { type: String },
  clientMessageId: { type: String, maxlength: 100, default: undefined },
  seen: { type: Boolean, default: false },
  seenAt: { type: Date },
  deliveredAt: { type: Date },
  editedAt: { type: Date },
  pinnedAt: { type: Date },
  pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  deletedForEveryone: { type: Boolean, default: false },
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    emoji: { type: String, enum: ["👍", "❤️", "😂", "😮", "😢", "🔥"], required: true },
    createdAt: { type: Date, default: Date.now },
  }],
  forwardedFrom: {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    senderName: { type: String, maxlength: 80 },
  },
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, maxlength: 500 },
    image: { type: String },
  },
}, { timestamps: true });

messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, clientMessageId: 1 }, {
  unique: true,
  partialFilterExpression: { clientMessageId: { $type: "string" } },
});

export default mongoose.model("Message", messageSchema);
