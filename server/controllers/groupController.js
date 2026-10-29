import mongoose from "mongoose";
import Group from "../models/Group.js";
import GroupMessage from "../models/GroupMessage.js";
import User from "../models/User.js";
import cloudinary from "../lib/cloudinary.js";
import { io } from "../server.js";
const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const memberOf = (group, userId) => group && group.members.some((member) => String(member._id || member) === String(userId));

const populateGroupMessage = (query) => query
  .populate("senderId", "fullName profilePic")
  .populate({
    path: "replyTo",
    select: "_id text image senderId deletedForEveryone createdAt",
    populate: { path: "senderId", select: "_id fullName profilePic" },
  });

export async function listGroups(req, res) {
  try {
    const groups = await Group.find({ members: req.user_id }).populate("members", "fullName profilePic isOnline").sort({ updatedAt: -1 }).lean();
    const latest = await GroupMessage.aggregate([
      { $match: { groupId: { $in: groups.map((g) => g._id) } } },
      { $sort: { createdAt: -1 } }, { $group: { _id: "$groupId", message: { $first: "$$ROOT" } } },
    ]);
    const byGroup = new Map(latest.map((row) => [String(row._id), row.message]));
    res.json({ success: true, groups: groups.map((group) => ({ ...group, lastMessage: byGroup.get(String(group._id)) || null })) });
  } catch (error) { console.error("List groups failed:", error.message); res.status(500).json({ success: false, message: "Unable to load groups" }); }
}

export async function createGroup(req, res) {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    const ids = Array.isArray(req.body.memberIds) ? [...new Set(req.body.memberIds.map(String))] : [];
    if (name.length < 2 || name.length > 80) return res.status(400).json({ success: false, message: "Group name must be 2–80 characters" });
    if (description.length > 500) return res.status(400).json({ success: false, message: "Description is too long" });
    if (ids.length > 99 || ids.some((id) => !validId(id))) return res.status(400).json({ success: false, message: "Invalid group members" });
    const uniqueIds = [...new Set([String(req.user_id), ...ids])];
    const existing = await User.find({ _id: { $in: uniqueIds } }).select("_id fullName profilePic isOnline");
    if (existing.length !== uniqueIds.length) return res.status(400).json({ success: false, message: "One or more members could not be found" });
    const group = await Group.create({ name, description, ownerId: req.user_id, members: uniqueIds, admins: [req.user_id] });
    const populated = await Group.findById(group._id).populate("members", "fullName profilePic isOnline").lean();
    for (const id of uniqueIds) io.to(`user:${id}`).emit("group-updated", { groupId: String(group._id) });
    res.status(201).json({ success: true, group: populated });
  } catch (error) { console.error("Create group failed:", error.message); res.status(500).json({ success: false, message: "Unable to create group" }); }
}

export async function addGroupMembers(req, res) {
  try {
    const { id } = req.params; const ids = Array.isArray(req.body.memberIds) ? [...new Set(req.body.memberIds.map(String))] : [];
    if (!validId(id) || !ids.length || ids.length > 99 || ids.some((memberId) => !validId(memberId))) return res.status(400).json({ success: false, message: "Choose valid members to add" });
    const group = await Group.findById(id);
    if (!memberOf(group, req.user_id)) return res.status(404).json({ success: false, message: "Group not found" });
    if (!group.admins.some((admin) => String(admin) === String(req.user_id))) return res.status(403).json({ success: false, message: "Only group admins can add members" });
    const users = await User.find({ _id: { $in: ids } }).select("_id");
    if (users.length !== ids.length) return res.status(400).json({ success: false, message: "One or more users were not found" });
    const added = ids.filter((userId) => !group.members.some((member) => String(member) === userId));
    group.members.addToSet(...added); await group.save();
    for (const userId of [...group.members.map(String), ...added]) io.to(`user:${userId}`).emit("group-updated", { groupId: String(group._id) });
    const populated = await Group.findById(group._id).populate("members", "fullName profilePic isOnline").lean();
    res.json({ success: true, group: populated });
  } catch (error) { console.error("Add group members failed:", error.message); res.status(500).json({ success: false, message: "Unable to update group members" }); }
}

export async function getGroupMessages(req, res) {
  try {
    const { id } = req.params; if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid group ID" });
    const group = await Group.findOne({ _id: id, members: req.user_id }).select("_id");
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
    const query = { groupId: id }; if (before) query.createdAt = { $lt: before };
    const rows = await populateGroupMessage(GroupMessage.find(query)).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    res.json({ success: true, messages: rows.reverse(), hasMore: rows.length === limit });
  } catch (error) { console.error("Get group messages failed:", error.message); res.status(500).json({ success: false, message: "Unable to load group messages" }); }
}

export async function sendGroupMessage(req, res) {
  try {
    const { id } = req.params; const senderId = String(req.user_id);
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const image = req.body.image;
    const requestedReplyTo = req.body.replyTo ? String(req.body.replyTo) : "";
    const clientMessageId = typeof req.body.clientMessageId === "string" ? req.body.clientMessageId.slice(0, 100) : undefined;
    if (!validId(id) || (!text && !image) || text.length > 10000) return res.status(400).json({ success: false, message: "Enter a message or attach an image" });
    if (requestedReplyTo && !validId(requestedReplyTo)) return res.status(400).json({ success: false, message: "Invalid reply target" });
    if (image && (typeof image !== "string" || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(image))) return res.status(400).json({ success: false, message: "Unsupported image format" });
    if (image && image.length > 4 * 1024 * 1024) return res.status(413).json({ success: false, message: "Image is too large (maximum 3 MB)" });
    const group = await Group.findOne({ _id: id, members: senderId }).select("_id members");
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });
    let replyToId = null;
    if (requestedReplyTo) {
      const replyTarget = await GroupMessage.findOne({ _id: requestedReplyTo, groupId: id }).select("_id deletedForEveryone");
      if (!replyTarget || replyTarget.deletedForEveryone) return res.status(400).json({ success: false, message: "The message you are replying to is unavailable" });
      replyToId = replyTarget._id;
    }
    if (clientMessageId) {
      const existing = await populateGroupMessage(GroupMessage.findOne({ senderId, clientMessageId })).lean();
      if (existing) {
        // Idempotency keys are unique per sender. Never return a message from a
        // different group when a client accidentally reuses a key.
        if (String(existing.groupId) !== String(id)) {
          return res.status(409).json({ success: false, message: "This message ID was already used for another message" });
        }
        return res.json({ success: true, message: existing, duplicate: true });
      }
    }
    let imageUrl;
    if (image) {
      const uploaded = await cloudinary.uploader.upload(image, { folder: "chatapp/group-messages", resource_type: "image" });
      imageUrl = uploaded.secure_url;
    }
    const message = await GroupMessage.create({ groupId: id, senderId, text, image: imageUrl || "", ...(replyToId ? { replyTo: replyToId } : {}), ...(clientMessageId ? { clientMessageId } : {}) });
    const populated = await populateGroupMessage(GroupMessage.findById(message._id)).lean();
    io.to(`group:${id}`).emit("group-message", populated);
    await Group.updateOne({ _id: id }, { $set: { updatedAt: new Date() } });
    res.status(201).json({ success: true, message: populated });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await populateGroupMessage(GroupMessage.findOne({
        senderId: req.user_id,
        clientMessageId: req.body.clientMessageId,
        groupId: req.params.id,
      })).lean();
      if (existing) return res.json({ success: true, message: existing, duplicate: true });
      return res.status(409).json({ success: false, message: "This message ID was already used for another message" });
    }
    console.error("Send group message failed:", error.message);
    res.status(500).json({ success: false, message: "Unable to send group message" });
  }
}

export async function forwardGroupMessage(req, res) {
  try {
    const sourceMessageId = req.params.id;
    const targetGroupId = typeof req.body.targetGroupId === "string" ? req.body.targetGroupId : "";
    if (!validId(sourceMessageId) || !validId(targetGroupId)) {
      return res.status(400).json({ success: false, message: "Invalid message or destination group" });
    }

    const sourceMessage = await GroupMessage.findById(sourceMessageId).populate("senderId", "fullName");
    if (!sourceMessage || sourceMessage.deletedForEveryone) {
      return res.status(404).json({ success: false, message: "This message is no longer available to forward" });
    }
    const [sourceGroup, targetGroup] = await Promise.all([
      Group.findOne({ _id: sourceMessage.groupId, members: req.user_id }).select("_id name"),
      Group.findOne({ _id: targetGroupId, members: req.user_id }).select("_id name members"),
    ]);
    if (!sourceGroup) return res.status(403).json({ success: false, message: "You are no longer a member of the source group" });
    if (!targetGroup) return res.status(403).json({ success: false, message: "You must belong to the destination group to forward messages there" });

    const originalSenderName = sourceMessage.forwardedFrom?.senderName || sourceMessage.senderId?.fullName || "Group member";
    const originalGroupName = sourceMessage.forwardedFrom?.groupName || sourceGroup.name || "Group";
    const forwarded = await GroupMessage.create({
      groupId: targetGroup._id,
      senderId: req.user_id,
      text: sourceMessage.text || "",
      image: sourceMessage.image || "",
      forwardedFrom: { senderName: originalSenderName, groupName: originalGroupName },
    });
    const populated = await populateGroupMessage(GroupMessage.findById(forwarded._id)).lean();
    await Group.updateOne({ _id: targetGroup._id }, { $set: { updatedAt: new Date() } });
    io.to(`group:${targetGroup._id}`).emit("group-message", populated);
    return res.status(201).json({ success: true, message: populated });
  } catch (error) {
    console.error("Forward group message failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to forward this group message" });
  }
}

export async function editGroupMessage(req, res) {
  try {
    const { id } = req.params;
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!validId(id) || !text || text.length > 10000) {
      return res.status(400).json({ success: false, message: "Enter a valid message" });
    }

    // Check the message and current membership before updating. This prevents a
    // former group member from editing an old message by calling the API directly.
    const existing = await GroupMessage.findOne({
      _id: id,
      senderId: req.user_id,
      deletedForEveryone: { $ne: true },
    }).select("_id groupId").lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Message not found or you cannot edit it" });
    }
    const group = await Group.exists({ _id: existing.groupId, members: req.user_id });
    if (!group) {
      return res.status(403).json({ success: false, message: "You are no longer a member of this group" });
    }

    const message = await populateGroupMessage(GroupMessage.findOneAndUpdate(
      { _id: id, senderId: req.user_id, deletedForEveryone: { $ne: true } },
      { $set: { text, editedAt: new Date() } },
      { new: true }
    )).lean();
    if (!message) return res.status(404).json({ success: false, message: "Message not found or you cannot edit it" });
    io.to(`group:${message.groupId}`).emit("group-message-updated", message);
    return res.json({ success: true, message });
  } catch (error) {
    console.error("Edit group message failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to edit message" });
  }
}

export async function deleteGroupMessage(req, res) {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid message ID" });
    const message = await GroupMessage.findOne({ _id: req.params.id }).populate("senderId", "fullName profilePic");
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });
    const group = await Group.findOne({ _id: message.groupId, members: req.user_id }).select("admins");
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });
    const admin = group.admins.some((id) => String(id) === String(req.user_id));
    if (String(message.senderId._id) !== String(req.user_id) && !admin) return res.status(403).json({ success: false, message: "Only the sender or a group admin can delete this message" });
    message.text = ""; message.image = ""; message.deletedForEveryone = true; await message.save();
    const output = await populateGroupMessage(GroupMessage.findById(message._id)).lean();
    io.to(`group:${message.groupId}`).emit("group-message-updated", output); res.json({ success: true, message: output });
  } catch { res.status(500).json({ success: false, message: "Unable to delete message" }); }
}


const GROUP_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢", "🔥"]);

export async function toggleGroupReaction(req, res) {
  try {
    const { id } = req.params;
    const emoji = typeof req.body.emoji === "string" ? req.body.emoji : "";
    if (!validId(id) || !GROUP_EMOJIS.has(emoji)) return res.status(400).json({ success: false, message: "Invalid reaction" });
    const message = await GroupMessage.findById(id);
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });
    const group = await Group.findOne({ _id: message.groupId, members: req.user_id }).select("_id");
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });
    const existing = message.reactions.find((item) => String(item.userId) === String(req.user_id) && item.emoji === emoji);
    if (existing) message.reactions = message.reactions.filter((item) => !(String(item.userId) === String(req.user_id) && item.emoji === emoji));
    else message.reactions.push({ userId: req.user_id, emoji });
    await message.save();
    const output = await populateGroupMessage(GroupMessage.findById(id)).lean();
    io.to(`group:${message.groupId}`).emit("group-message-updated", output);
    res.json({ success: true, message: output });
  } catch (error) { console.error("Group reaction failed:", error.message); res.status(500).json({ success: false, message: "Unable to update reaction" }); }
}

export async function toggleGroupPin(req, res) {
  try {
    const { id } = req.params;
    if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid message ID" });
    const message = await GroupMessage.findById(id);
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });
    const group = await Group.findOne({ _id: message.groupId, members: req.user_id });
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });
    if (!group.admins.some((admin) => String(admin) === String(req.user_id))) return res.status(403).json({ success: false, message: "Only group admins can pin messages" });
    group.pinnedMessageId = String(group.pinnedMessageId || "") === String(message._id) ? null : message._id;
    await group.save();
    const populatedGroup = await Group.findById(group._id).populate("members", "fullName profilePic isOnline").populate("pinnedMessageId").lean();
    io.to(`group:${group._id}`).emit("group-updated", { groupId: String(group._id), group: populatedGroup });
    res.json({ success: true, group: populatedGroup, pinned: Boolean(group.pinnedMessageId) });
  } catch (error) { console.error("Group pin failed:", error.message); res.status(500).json({ success: false, message: "Unable to pin message" }); }
}

export async function markGroupRead(req, res) {
  try {
    const { id } = req.params;
    if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid group ID" });
    const group = await Group.findOne({ _id: id, members: req.user_id }).select("_id");
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });
    const now = new Date();
    await GroupMessage.updateMany({ groupId: id, senderId: { $ne: req.user_id }, "readBy.userId": { $ne: req.user_id } }, { $push: { readBy: { userId: req.user_id, readAt: now } } });
    io.to(`group:${id}`).emit("group-read", { groupId: String(id), userId: String(req.user_id), readAt: now });
    res.json({ success: true, readAt: now });
  } catch (error) { console.error("Group read receipt failed:", error.message); res.status(500).json({ success: false, message: "Unable to update read receipts" }); }
}

export async function removeGroupMember(req, res) {
  try {
    const { id, memberId } = req.params;
    if (!validId(id) || !validId(memberId)) return res.status(400).json({ success: false, message: "Invalid group or member ID" });
    const group = await Group.findById(id);
    if (!memberOf(group, req.user_id)) return res.status(404).json({ success: false, message: "Group not found" });
    const isAdmin = group.admins.some((admin) => String(admin) === String(req.user_id));
    const isSelf = String(memberId) === String(req.user_id);
    if (!isSelf && !isAdmin) return res.status(403).json({ success: false, message: "Only group admins can remove members" });
    if (!group.members.some((member) => String(member) === String(memberId))) return res.status(404).json({ success: false, message: "Member is not in this group" });
    const ownerLeaving = String(group.ownerId) === String(memberId);
    const remainingMembers = group.members.filter((member) => String(member) !== String(memberId));
    if (ownerLeaving && remainingMembers.length) {
      const nextOwner = group.admins.find((admin) => String(admin) !== String(memberId) && remainingMembers.some((member) => String(member) === String(admin))) || remainingMembers[0];
      group.ownerId = nextOwner;
      group.admins.addToSet(nextOwner);
    }
    group.members = remainingMembers;
    group.admins = group.admins.filter((admin) => String(admin) !== String(memberId));
    if (!group.members.length) {
      await GroupMessage.deleteMany({ groupId: group._id }); await group.deleteOne();
      io.to(`user:${memberId}`).emit("group-removed", { groupId: String(id) });
      return res.json({ success: true, deleted: true });
    }
    await group.save();
    for (const userId of [...group.members.map(String), String(memberId)]) {
      io.to(`user:${userId}`).emit("group-updated", { groupId: String(group._id) });
      if (userId === String(memberId)) io.to(`user:${userId}`).emit("group-removed", { groupId: String(group._id) });
    }
    const populated = await Group.findById(group._id).populate("members", "fullName profilePic isOnline").lean();
    res.json({ success: true, group: populated });
  } catch (error) { console.error("Group member removal failed:", error.message); res.status(500).json({ success: false, message: "Unable to update group members" }); }
}
