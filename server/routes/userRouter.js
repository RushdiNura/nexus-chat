import express from "express";
import { checkAuth, getUserProfile, login, signup, updateProfile } from "../controllers/userController.js";
import { verifyUser } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/rateLimit.js";

const userRouter = express.Router();
const limitAuthAttempts = authRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

userRouter.post("/signup", limitAuthAttempts, signup);
userRouter.post("/login", limitAuthAttempts, login);
userRouter.get("/get-profile", verifyUser, getUserProfile);
userRouter.get("/check", verifyUser, checkAuth);
userRouter.put("/update-profile", verifyUser, updateProfile);

export default userRouter;
