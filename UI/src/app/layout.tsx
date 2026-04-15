import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { AudioProvider } from "@/contexts/AudioContext";
import { VoiceProvider } from "@/contexts/VoiceContext";

export const metadata: Metadata = {
  title: "VibeVoice AI — Premium Voice Studio",
  description: "Next-gen AI voice platform for tutors, podcasters, and interviewers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <VoiceProvider>
            <AudioProvider>{children}</AudioProvider>
          </VoiceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
