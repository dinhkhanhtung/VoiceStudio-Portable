import { Play, Square, Download, Volume2, X, Music } from "lucide-react";

export function AudioPlayer() {
  // This is a static representation of the audio player layout
  return (
    <div className="fixed bottom-0 left-64 right-0 bg-card border-t border-border shadow-lg z-40 transition-transform duration-300 transform translate-y-0">
      {/* Progress Bar */}
      <div className="group relative bg-muted cursor-pointer touch-none transition-[height] h-2 hover:h-3">
        <div className="h-full bg-primary pointer-events-none" style={{ width: "35%" }}></div>
        <div 
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-background shadow pointer-events-none transition-transform group-hover:scale-110" 
          style={{ left: "35%" }}
        ></div>
      </div>
      
      {/* Controls */}
      <div className="px-6 py-3 flex items-center gap-4">
        {/* Track Icon */}
        <div className="w-11 h-11 rounded-lg flex items-center justify-center text-white shrink-0 bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
          <Music className="w-5 h-5" />
        </div>
        
        {/* Track Info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">Mẫu giọng đọc thử nghiệm</p>
          <p className="text-xs text-muted-foreground truncate">Đọc bởi: AI Voice Studio</p>
        </div>
        
        {/* Time */}
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">0:12 / 0:34</span>
        
        {/* Playback Controls */}
        <button className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 hover:bg-muted transition-colors text-foreground">
          <Play className="w-4 h-4" />
        </button>
        <button className="flex items-center justify-center w-8 h-8 rounded-md shrink-0 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <Square className="w-4 h-4" />
        </button>
        
        {/* Rate Control */}
        <button className="flex items-center justify-center shrink-0 w-12 h-8 text-[12px] font-medium tabular-nums hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground">
          1x
        </button>
        
        {/* Download */}
        <button className="flex items-center justify-center w-8 h-8 rounded-md shrink-0 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <Download className="w-4 h-4" />
        </button>
        
        {/* Volume */}
        <button className="flex items-center justify-center w-8 h-8 rounded-md shrink-0 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <Volume2 className="w-4 h-4" />
        </button>
        
        {/* Close */}
        <button className="flex items-center justify-center w-8 h-8 rounded-md shrink-0 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
