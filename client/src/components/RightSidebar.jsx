import React from "react";
import assets from "../assets/assets";
import { useContext } from "react";
import { ChatContext } from "../context/ChatContext";
import AuthContext from "../context/AuthContext";
import { formatLastSeen } from "../lib/utils";
import { useState } from "react";
import { useEffect } from "react";

function RightSidebar() {
  const { selectedUser, messages } = useContext(ChatContext);
  const { logout, onlineUsers } = useContext(AuthContext);
  const [msgImages, setMsgImages] = useState([]);
  const [presenceClock, setPresenceClock] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setPresenceClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setMsgImages(messages.filter((msg) => msg.image).map((msg) => msg.image));
  }, [messages]);

  // Function to handle image loading errors
  const handleImageError = (e, fallbackSrc = assets.avatar_icon) => {
    e.target.src = fallbackSrc;
    e.target.onerror = null; // Prevent infinite loop
  };

  // Function to get correct image source
  const getImageSource = (imageUrl, fallback = assets.avatar_icon) => {
    if (!imageUrl) return fallback;

    // Check if it's a relative path or full URL
    if (imageUrl.startsWith("http") || imageUrl.startsWith("data:")) {
      return imageUrl;
    }

    // If it's a relative path, prepend the backend URL
    return `${import.meta.env.VITE_BACKEND_URL}${imageUrl}`;
  };

  if (!selectedUser) return null;

  const isOnline = onlineUsers.includes(selectedUser._id);

  return (
    <div className="nexus-details h-full bg-gradient-to-b from-slate-900/70 to-purple-900/30 p-5 overflow-y-auto border-l border-purple-500/10 max-md:hidden flex flex-col">
      {/* User Profile Header */}
      <div className="text-center mb-6">
        <div className="relative mx-auto w-24 h-24 mb-4">
          <div className="absolute -inset-2 bg-gradient-to-r from-purple-600/30 to-pink-600/30 rounded-full blur-lg"></div>
          <img
            src={getImageSource(selectedUser.profilePic)}
            alt={selectedUser.fullName}
            onError={(e) => handleImageError(e)}
            className="w-full h-full rounded-full object-cover border-3 border-slate-800/50 shadow-xl relative z-10"
          />
          {isOnline && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-slate-900 z-20"></div>
          )}
        </div>
        <h1 className="text-lg font-bold text-white mb-1">
          {selectedUser.fullName}
        </h1>
        <p className={`text-xs mt-1 ${isOnline ? "text-emerald-400" : "text-slate-400"}`}>
          {isOnline ? "Online" : formatLastSeen(selectedUser.lastSeen, presenceClock)}
        </p>
        <p className="text-slate-300 text-xs mt-2">
          {selectedUser.bio || "No bio available"}
        </p>

        <div className="mt-3 flex justify-center gap-2">
          <button type="button" disabled title="Voice calls are not implemented yet" className="px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-500 text-xs cursor-not-allowed">
            Calls unavailable
          </button>
          <button type="button" disabled title="Video calls are not implemented yet" className="px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-500 text-xs cursor-not-allowed">
            Video unavailable
          </button>
        </div>
      </div>

      <hr className="border-purple-500/10 mb-4" />

      {/* Media Section */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-purple-400/60 uppercase tracking-wider mb-3 flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
              clipRule="evenodd"
            />
          </svg>
          Shared Media
        </h3>
        {msgImages.length === 0 ? (
          <p className="text-slate-400 text-xs text-center py-4">
            No shared media
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {msgImages.slice(0, 6).map((url, index) => (
              <div
                key={index}
                className="aspect-square rounded-lg overflow-hidden cursor-pointer transform hover:scale-105 transition-transform duration-300 group relative"
                onClick={() => window.open(getImageSource(url))}
              >
                <div className="absolute inset-0 bg-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <img
                  src={getImageSource(url)}
                  alt={`Media ${index + 1}`}
                  onError={(e) => handleImageError(e, assets.avatar_icon)}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <hr className="border-purple-500/10 mb-4" />

      {/* User Details */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-purple-400/60 uppercase tracking-wider mb-3 flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
          </svg>
          Details
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-slate-300 text-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5 text-purple-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                clipRule="evenodd"
              />
            </svg>
            {selectedUser.location || "Location not set"}
          </div>
          <div className="flex items-center gap-2 text-slate-300 text-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5 text-purple-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
              <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
            </svg>
            {selectedUser.email}
          </div>
          <div className="flex items-center gap-2 text-slate-300 text-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5 text-purple-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                clipRule="evenodd"
              />
            </svg>
            {selectedUser.createdAt
              ? `Joined ${new Date(
                  selectedUser.createdAt
                ).toLocaleDateString()}`
              : "Joined date unknown"}
          </div>
        </div>
      </div>

      <hr className="border-purple-500/10 mb-4" />

      {/* Actions */}
      <div className="space-y-2">
        <button type="button" disabled title="Support actions are not implemented yet" className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg py-2 px-3 text-slate-500 cursor-not-allowed text-xs flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          Help & Support
        </button>
        <button type="button" disabled title="Blocking is not implemented yet" className="w-full bg-red-500/5 border border-red-500/10 rounded-lg py-2 px-3 text-red-300/60 cursor-not-allowed text-xs flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
          Block User
        </button>
      </div>

      {/* Logout Button at the bottom */}
      <div className="mt-auto pt-4">
        <button
          onClick={logout}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium py-2.5 rounded-lg transition-all duration-300 shadow-lg hover:shadow-purple-500/25 text-sm"
        >
          Logout
        </button>
      </div>
    </div>
  );
}

export default RightSidebar;
