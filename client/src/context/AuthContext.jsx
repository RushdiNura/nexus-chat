import { createContext, useCallback, useEffect, useRef, useState } from "react";
/* eslint-disable react-refresh/only-export-components */
import axios from "axios";
import toast from "react-hot-toast";
import { io } from "socket.io-client";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
axios.defaults.baseURL = backendUrl;
export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [authUser, setAuthUser] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setSocket(null);
    setOnlineUsers([]);
  }, []);

  const connectSocket = useCallback((accessToken) => {
    if (!accessToken) return;
    if (socketRef.current) {
      socketRef.current.auth = { token: accessToken };
      if (!socketRef.current.connected) socketRef.current.connect();
      return;
    }
    const nextSocket = io(backendUrl, {
      auth: { token: accessToken },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    nextSocket.on("online-users", (ids) => setOnlineUsers(Array.isArray(ids) ? ids : []));
    nextSocket.on("user-status-changed", ({ userId, isOnline }) => {
      setOnlineUsers((current) => isOnline
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId));
    });
    nextSocket.on("connect_error", (error) => {
      if (/token|auth/i.test(error.message)) toast.error("Your session expired. Please sign in again.");
    });
    socketRef.current = nextSocket;
    setSocket(nextSocket);
  }, []);

  const checkAuth = useCallback(async () => {
    const storedToken = localStorage.getItem("token");
    if (!storedToken) return;
    try {
      axios.defaults.headers.common.Authorization = `Bearer ${storedToken}`;
      const { data } = await axios.get("/api/auth/check");
      if (data.success) {
        setAuthUser(data.user);
        setToken(storedToken);
        connectSocket(storedToken);
      }
    } catch {
      localStorage.removeItem("token");
      delete axios.defaults.headers.common.Authorization;
      setToken(null);
      setAuthUser(null);
      disconnectSocket();
    }
  }, [connectSocket, disconnectSocket]);

  const login = async (state, credentials) => {
    try {
      const { data } = await axios.post(`/api/auth/${state}`, credentials);
      if (!data.success) {
        toast.error(data.message || "Unable to sign in");
        return false;
      }
      localStorage.setItem("token", data.token);
      axios.defaults.headers.common.Authorization = `Bearer ${data.token}`;
      setToken(data.token);
      setAuthUser(data.user);
      connectSocket(data.token);
      toast.success(data.message);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to sign in");
      return false;
    }
  };

  const logout = async () => {
    disconnectSocket();
    localStorage.removeItem("token");
    delete axios.defaults.headers.common.Authorization;
    setAuthUser(null);
    setToken(null);
    toast.success("Logged out");
  };

  const updateProfile = async (body) => {
    try {
      const { data } = await axios.put("/api/auth/update-profile", body);
      if (data.success) {
        setAuthUser(data.user);
        toast.success(data.message || "Profile updated");
        return true;
      }
      toast.error(data.message || "Unable to update profile");
      return false;
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to update profile");
      return false;
    }
  };

  useEffect(() => {
    if (token) checkAuth();
    else disconnectSocket();
    // Initial session restore only; subsequent token changes happen through login/logout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = { axios, socket, onlineUsers, authUser, login, logout, updateProfile, checkAuth, token };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
