import mongoose from "mongoose";
import "dotenv/config";

export async function connectDB() {
  if (!process.env.MYDATABASE) throw new Error("MYDATABASE is required");
  mongoose.set("strictQuery", true);
  await mongoose.connect(process.env.MYDATABASE, {
    serverSelectionTimeoutMS: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  });
  console.log("Database connected");
  return mongoose.connection;
}
