import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 500, default: "" },
  avatar: { type: String, default: "" },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  pinnedMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage", default: null },
}, { timestamps: true });
groupSchema.index({ members: 1, updatedAt: -1 });
export default mongoose.model("Group", groupSchema);
