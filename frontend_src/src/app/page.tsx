"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AudioPlayer } from "@/components/layout/audio-player";
import { TextToSpeechView } from "@/components/views/text-to-speech";
import { useAppContext } from "@/lib/context/app-context";

export default function Home() {
  const { activeView } = useAppContext();

  return (
    <div className="flex h-screen overflow-hidden bg-background transition-colors duration-300">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] pb-24">
          <div className="p-8">
            {activeView === "tts" && <TextToSpeechView />}
            {activeView !== "tts" && (
              <div className="flex items-center justify-center h-[50vh] text-muted-foreground">
                <p>Tính năng này đang được phát triển...</p>
              </div>
            )}
          </div>
        </main>
      </div>
      <AudioPlayer />
    </div>
  );
}
