"use client";

import type { TabId } from "@/components/AppShell";

const features = [
  {
    id: "interview" as TabId,
    icon: "👔",
    title: "Interview Prep Room",
    description:
      "Upload your resume and job description for a real-time AI mock interview. Get scored and receive detailed feedback.",
    tag: "Real-Time Voice",
    className: "interview",
  },
  {
    id: "tutor" as TabId,
    icon: "🗣️",
    title: "Language Café",
    description:
      "Practice conversations in 10+ languages with an AI tutor that adapts to your level. Instant voice responses.",
    tag: "10 Languages",
    className: "tutor",
  },
  {
    id: "podcast" as TabId,
    icon: "🎙️",
    title: "Podcast Studio",
    description:
      "Turn any article or blog post into an engaging multi-speaker podcast. Up to 4 AI voices debating your content.",
    tag: "Multi-Speaker",
    className: "podcast",
  },
  {
    id: "clone" as TabId,
    icon: "🎧",
    title: "Clone Desk",
    description:
      "Clone any voice from a 15-second sample. Generate voiceovers, fix flubbed lines, or create custom content.",
    tag: "Voice Cloning",
    className: "clone",
  },
];

type Props = {
  onNavigate: (tab: TabId) => void;
};

export default function DashboardContent({ onNavigate }: Props) {
  return (
    <>
      <div className="page-header">
        <h2>Welcome to The Vibe Suite</h2>
        <p>Pick a tool below to get started with AI-powered voice generation</p>
      </div>

      <div className="feature-grid">
        {features.map((feature) => (
          <button
            key={feature.id}
            className={`feature-card ${feature.className}`}
            onClick={() => onNavigate(feature.id)}
            id={`feature-card-${feature.id}`}
          >
            <div className="feature-icon">{feature.icon}</div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
            <span className="feature-tag">{feature.tag}</span>
          </button>
        ))}
      </div>
    </>
  );
}
