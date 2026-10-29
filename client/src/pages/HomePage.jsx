// client/src/pages/HomePage.jsx
import React from "react";
import Sidebar from "../components/Sidebar";
import ChatContainer from "../components/ChatContainer";
import RightSidebar from "../components/RightSidebar";
import GroupChatContainer from "../components/GroupChatContainer";
import { useContext } from "react";
import { ChatContext } from "../context/ChatContext";

function HomePage() {
  const {selectedUser, selectedGroup} = useContext(ChatContext)

  return (
    <div className="nexus-home">
      <div className="nexus-window">
        <div
          className={`grid nexus-home-grid h-full min-w-0 transition-all duration-300 ${
            selectedGroup
              ? "nexus-home-grid--group grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]"
              : selectedUser
                ? "grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)_280px]"
                : "grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]"
          }`}
        >
          <Sidebar />
          {selectedGroup ? <GroupChatContainer /> : <ChatContainer />}
          {selectedUser && !selectedGroup && <RightSidebar />}
        </div>
      </div>
    </div>
  );
}

export default HomePage;
