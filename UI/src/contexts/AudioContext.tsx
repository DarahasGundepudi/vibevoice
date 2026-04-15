"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";

type AudioTrack = {
  url: string;
  name: string;
  tool: string;
};

type AudioContextType = {
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  playAudio: (url: string, name: string, tool: string) => void;
  pause: () => void;
  resume: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

const AudioCtx = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = useCallback((url: string, name: string, tool: string) => {
    setCurrentTrack({ url, name, tool });
    setIsPlaying(true);
    // The AudioPlayer component will handle actual playback via audioRef
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch(() => {});
      }
    }, 50);
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play().catch(() => {});
    setIsPlaying(true);
  }, []);

  return (
    <AudioCtx.Provider value={{ currentTrack, isPlaying, playAudio, pause, resume, audioRef }}>
      {children}
    </AudioCtx.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}
