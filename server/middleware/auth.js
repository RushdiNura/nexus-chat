import jwt from "jsonwebtoken";

export const verifyUser = (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
    if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
    const verified = jwt.verify(token, process.env.MY_JWT);
    req.user = verified;
    req.user_id = verified.id;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired session" });
  }
};
