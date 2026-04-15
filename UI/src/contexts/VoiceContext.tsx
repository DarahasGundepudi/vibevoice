"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { useSession } from "next-auth/react";

export type CustomVoice = {
  id: string;
  name: string;
  sampleUrl: string;
  language: string;
  createdAt: string;
};

type VoiceContextType = {
  customVoices: CustomVoice[];
  addCustomVoice: (name: string, blob: Blob) => Promise<CustomVoice | null>;
  deleteCustomVoice: (id: string) => Promise<boolean>;
  renameCustomVoice: (id: string, newName: string) => Promise<boolean>;
  loading: boolean;
};

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [customVoices, setCustomVoices] = useState<CustomVoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch voices for current user
  const fetchVoices = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    try {
      const res = await fetch("/api/voices");
      if (res.ok) {
        const data = await res.json();
        setCustomVoices(data.voices || []);
      }
    } catch (err) {
      console.error("Failed to fetch voices:", err);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

  // Upload/Save a new voice
  const addCustomVoice = useCallback(async (name: string, blob: Blob) => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("file", blob, "sample.wav");

    try {
      const res = await fetch("/api/voices", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const newVoice = data.voice;
        setCustomVoices((prev) => [newVoice, ...prev]);
        return newVoice;
      }
      return null;
    } catch (err) {
      console.error("Failed to save voice:", err);
      return null;
    }
  }, []);

  // Delete a voice
  const deleteCustomVoice = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/voices/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setCustomVoices((prev) => prev.filter((v) => v.id !== id));
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to delete voice:", err);
      return false;
    }
  }, []);

  // Rename a voice
  const renameCustomVoice = useCallback(async (id: string, newName: string) => {
    try {
      const res = await fetch(`/api/voices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });

      if (res.ok) {
        const data = await res.json();
        const updatedVoice = data.voice;
        setCustomVoices((prev) =>
          prev.map((v) => (v.id === id ? updatedVoice : v))
        );
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to rename voice:", err);
      return false;
    }
  }, []);

  return (
    <VoiceContext.Provider
      value={{
        customVoices,
        addCustomVoice,
        deleteCustomVoice,
        renameCustomVoice,
        loading,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoices() {
  const context = useContext(VoiceContext);
  if (context === undefined) {
    throw new Error("useVoices must be used within a VoiceProvider");
  }
  return context;
}
