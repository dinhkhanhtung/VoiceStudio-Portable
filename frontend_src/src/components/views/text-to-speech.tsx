"use client";

import { useState } from "react";
import { Play, Search, Loader2, Volume2 } from "lucide-react";
import { useAppContext } from "@/lib/context/app-context";
import { synthesizeAudio } from "@/lib/api";

export function TextToSpeechView() {
  const { voices, selectedVoice, setSelectedVoice, isLoadingVoices } = useAppContext();
  const [text, setText] = useState("");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [search, setSearch] = useState("");

  const filteredVoices = voices.filter(v => 
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSynthesize = async () => {
    if (!text.trim() || !selectedVoice) return;
    
    setIsSynthesizing(true);
      try {
        const response = await synthesizeAudio({
          text,
          voiceId: selectedVoice.id,
          speed: 1.0,
        });
        
        if (response.success && response.audioUrl) {
          // Play audio directly for now (TODO: connect to AudioPlayer component)
          const audio = new Audio(response.audioUrl);
          audio.play();
        } else {
          throw new Error(response.error || "Lỗi tạo giọng đọc");
        }
      } catch (err: any) {
        alert("Lỗi: " + err.message);
      } finally {
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="text-[20px] font-semibold text-foreground mb-2">Đọc văn bản</h2>
          <p className="text-muted-foreground text-[14px]">Chuyển văn bản thành giọng đọc tự nhiên</p>
        </div>
        <div className="space-y-2 mb-6">
          <label className="flex items-center gap-2 text-sm leading-none font-medium select-none">Văn bản cần đọc</label>
          <textarea 
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] flex w-full rounded-md border bg-muted/30 px-3 py-2 text-base transition-[color,box-shadow] outline-none min-h-[320px] resize-none" 
            placeholder="Nhập văn bản bạn muốn chuyển thành giọng nói..." 
            spellCheck="false"
          ></textarea>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{text.length} ký tự</span>
            <span>{text.split(/\s+/).filter(Boolean).length} từ</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1"></div>
          <button 
            disabled={!text.trim() || !selectedVoice || isSynthesizing}
            onClick={handleSynthesize}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md px-8 shadow-sm disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSynthesizing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
            {isSynthesizing ? "Đang tạo..." : "Tạo giọng đọc"}
          </button>
        </div>
      </div>
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="flex flex-col gap-2 flex-1">
          <div className="bg-muted text-muted-foreground h-9 items-center justify-center rounded-xl p-[3px] flex w-[calc(100%-1rem)] mx-2 mt-2">
            <button className="bg-card text-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-xl border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap shadow-sm">
              Giọng nói
            </button>
          </div>
          <div className="flex-1 outline-none p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base bg-muted/30 transition-[color,box-shadow] outline-none pl-9 text-sm" 
                placeholder="Tìm giọng nói..." 
              />
            </div>
            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
              {isLoadingVoices ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : filteredVoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Không tìm thấy giọng nói</p>
              ) : (
                filteredVoices.map((voice) => (
                  <div key={voice.id} className="flex items-center gap-2 w-full">
                    <button
                      onClick={() => setSelectedVoice(voice)}
                      className={`flex-1 text-left px-3 py-2 text-sm rounded-md transition-colors ${
                        selectedVoice?.id === voice.id
                          ? "bg-primary text-primary-foreground font-medium"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      {voice.name}
                    </button>
                    {(voice as any).sampleUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          new Audio((voice as any).sampleUrl).play();
                        }}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md shrink-0"
                        title="Nghe thử"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
