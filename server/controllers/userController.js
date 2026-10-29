import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import cloudinary from "../lib/cloudinary.js";

const publicUser = (user) => {
  const value = user.toObject ? user.toObject() : { ...user };
  delete value.password;
  return value;
};
const makeToken = (id) => jwt.sign({ id: String(id) }, process.env.MY_JWT, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });

export const signup = async (req, res) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const bio = String(req.body.bio || "").trim();
    if (fullName.length < 2 || fullName.length > 80) return res.status(400).json({ success: false, message: "Name must be between 2 and 80 characters" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid email address" });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ success: false, message: "Password must be 8–128 characters" });
    if (!process.env.MY_JWT) return res.status(500).json({ success: false, message: "Authentication is not configured" });
    if (await User.findOne({ email })) return res.status(409).json({ success: false, message: "An account with this email already exists" });
    const user = await User.create({ fullName, email, password: await bcrypt.hash(password, 12), bio });
    return res.status(201).json({ success: true, token: makeToken(user._id), user: publicUser(user), message: "Account created successfully" });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "An account with this email already exists" });
    console.error("Signup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to create account" });
  }
};

export const login = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: "Invalid email or password" });
    if (!process.env.MY_JWT) return res.status(500).json({ success: false, message: "Authentication is not configured" });
    return res.status(200).json({ success: true, token: makeToken(user._id), user: publicUser(user), message: "Welcome back" });
  } catch (error) {
    console.error("Login failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to sign in" });
  }
};

export const checkAuth = async (req, res) => {
  const user = await User.findById(req.user_id).select("-password");
  if (!user) return res.status(401).json({ success: false, message: "User no longer exists" });
  return res.status(200).json({ success: true, user });
};

export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user_id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load profile" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const bio = String(req.body.bio || "").trim();
    const location = typeof req.body.location === "string" ? req.body.location.trim() : undefined;
    const updates = {};
    if (fullName) {
      if (fullName.length < 2 || fullName.length > 80) return res.status(400).json({ success: false, message: "Name must be between 2 and 80 characters" });
      updates.fullName = fullName;
    }
    updates.bio = bio.slice(0, 300);
    if (location !== undefined) {
      if (location.length > 100) return res.status(400).json({ success: false, message: "Location must be 100 characters or fewer" });
      updates.location = location;
    }
    if (req.body.profilePic) {
      if (typeof req.body.profilePic !== "string" || !req.body.profilePic.startsWith("data:image/")) return res.status(400).json({ success: false, message: "Profile picture must be an image" });
      const uploaded = await cloudinary.uploader.upload(req.body.profilePic, { folder: "chatapp/profiles", resource_type: "image" });
      updates.profilePic = uploaded.secure_url;
    }
    const user = await User.findByIdAndUpdate(req.user_id, { $set: updates }, { new: true, runValidators: true }).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.status(200).json({ success: true, user, message: "Profile updated successfully" });
  } catch (error) {
    console.error("Profile update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update profile" });
  }
};
