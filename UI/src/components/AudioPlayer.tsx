"use client";

import { useAudio } from "@/contexts/AudioContext";
import { useEffect, useRef, useState } from "react";

export function AudioPlayer() {
  const { currentTrack, isPlaying, pause, resume, audioRef } = useAudio();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => pause();

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioRef, pause]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressRef.current;
    if (!bar || !audioRef.current) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const formatTime = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const toolColors: Record<string, string> = {
    interview: "var(--accent-blue)",
    tutor: "var(--accent-green)",
    podcast: "var(--accent-purple)",
    clone: "var(--accent-orange)",
  };

  if (!currentTrack) return <audio ref={audioRef} style={{ display: "none" }} />;

  const accentColor = toolColors[currentTrack.tool] || "var(--accent-blue)";
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <audio ref={audioRef} style={{ display: "none" }} />
      <div className="global-audio-player">
        <div className="player-track-info">
          <div className="player-track-dot" style={{ background: accentColor }} />
          <div className="player-track-name">{currentTrack.name}</div>
          <div className="player-track-tool">{currentTrack.tool}</div>
        </div>

        <div className="player-controls">
          <button
            className="player-btn"
            onClick={() => (isPlaying ? pause() : resume())}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>

          <span className="player-time">{formatTime(currentTime)}</span>

          <div className="player-progress" ref={progressRef} onClick={handleSeek}>
            <div
              className="player-progress-fill"
              style={{ width: `${progress}%`, background: accentColor }}
            />
            <div
              className="player-progress-thumb"
              style={{ left: `${progress}%`, borderColor: accentColor }}
            />
          </div>

          <span className="player-time">{formatTime(duration)}</span>

          <div className="player-volume">
            <span>🔊</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolume}
              className="player-volume-slider"
            />
          </div>

          {currentTrack.url && (
            <a className="player-download" href={currentTrack.url} download>
              ⬇
            </a>
          )}
        </div>
      </div>
    </>
  );
}
