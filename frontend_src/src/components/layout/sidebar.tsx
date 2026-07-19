import { Mic, Volume2, Languages, Library, History, Settings } from "lucide-react";

export function Sidebar() {
  return (
    <div className="w-64 h-screen bg-card border-r border-border flex flex-col transition-colors duration-300">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Mic className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-foreground">Voice Studio</h1>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4">
        <div className="space-y-1">
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 bg-primary text-primary-foreground shadow-sm">
            <Volume2 className="w-5 h-5" />
            <span className="text-[15px] font-medium">Đọc văn bản</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-foreground hover:bg-muted hover:text-foreground">
            <Languages className="w-5 h-5" />
            <span className="text-[15px] font-medium">Dịch</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-foreground hover:bg-muted hover:text-foreground">
            <Library className="w-5 h-5" />
            <span className="text-[15px] font-medium">Thư viện giọng nói</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-foreground hover:bg-muted hover:text-foreground">
            <Mic className="w-5 h-5" />
            <span className="text-[15px] font-medium">Giọng nói của bạn</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-foreground hover:bg-muted hover:text-foreground">
            <History className="w-5 h-5" />
            <span className="text-[15px] font-medium">Lịch sử</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-foreground hover:bg-muted hover:text-foreground">
            <Settings className="w-5 h-5" />
            <span className="text-[15px] font-medium">Cài đặt</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
