import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AudioPlayer } from "@/components/layout/audio-player";
import { TextToSpeechView } from "@/components/views/text-to-speech";

export default function Home() {
  return (
    <div className="flex h-screen overflow-hidden bg-background transition-colors duration-300">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] pb-24">
          <div className="p-8">
            <TextToSpeechView />
          </div>
        </main>
      </div>
      <AudioPlayer />
    </div>
  );
}
