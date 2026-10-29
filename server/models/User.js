import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  password: { type: String, required: true, minlength: 8, select: false },
  profilePic: { type: String, default: "default-avatar.png" },
  bio: { type: String, default: "Hi Everyone, I am Using NexusChat", maxlength: 300 },
  location: { type: String, trim: true, maxlength: 100, default: "" },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model("User", userSchema);
