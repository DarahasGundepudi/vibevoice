"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AudioProvider } from "@/contexts/AudioContext";
import { AudioPlayer } from "@/components/AudioPlayer";
import { Sidebar } from "@/components/Sidebar";

// Import all tool pages as components
import InterviewPage from "@/app/interview/page";
import TutorPage from "@/app/tutor/page";
import PodcastPage from "@/app/podcast/page";
import ClonePage from "@/app/clone/page";
import DashboardContent from "@/components/DashboardContent";

export type TabId = "dashboard" | "interview" | "tutor" | "podcast" | "clone";

export function AppShell() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");

  // Redirect to login if not authenticated
  if (status === "loading") {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
        <p>Loading The Vibe Suite...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  return (
    <AudioProvider>
      <div className="app-shell">
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          user={session?.user || null}
        />

        <main className="main-content">
          {/* All tabs render simultaneously but only active one is visible.
              This preserves React state (form data, audio, chat) when switching tabs. */}
          <div style={{ display: activeTab === "dashboard" ? "block" : "none" }}>
            <DashboardContent onNavigate={setActiveTab} />
          </div>
          <div style={{ display: activeTab === "interview" ? "block" : "none" }}>
            <InterviewPage />
          </div>
          <div style={{ display: activeTab === "tutor" ? "block" : "none" }}>
            <TutorPage />
          </div>
          <div style={{ display: activeTab === "podcast" ? "block" : "none" }}>
            <PodcastPage />
          </div>
          <div style={{ display: activeTab === "clone" ? "block" : "none" }}>
            <ClonePage />
          </div>
        </main>

        {/* Persistent audio player — always mounted */}
        <AudioPlayer />
      </div>
    </AudioProvider>
  );
}
