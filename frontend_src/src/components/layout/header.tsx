import { Heart, Moon, Globe, Code, Bell } from "lucide-react";

export function Header() {
  return (
    <div className="h-16 bg-card border-b border-border px-6 flex items-center justify-between transition-colors duration-300">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground tracking-tight">Đọc văn bản</h1>
      </div>
      <div className="flex items-center gap-4">
        <button className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50 py-2 h-10 px-3 rounded-lg gap-1.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-all duration-300 active:scale-95">
          <Heart className="w-4 h-4" />
          <span className="text-sm font-medium">Donate</span>
        </button>
        <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50 w-10 h-10 rounded-lg hover:bg-muted/80 dark:hover:bg-muted/30 transition-all duration-300 active:scale-95 border border-transparent hover:border-border" title="Chuyển đổi giao diện">
          <Moon className="w-[18px] h-[18px] text-foreground transition-transform duration-500" />
        </button>
        <button className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50 h-10 px-3 rounded-lg gap-1.5 hover:bg-muted/80 dark:hover:bg-muted/30 transition-all duration-300 active:scale-95 border border-transparent hover:border-border">
          <Globe className="w-[18px] h-[18px] text-foreground/80" />
          <span className="text-sm font-medium">VI</span>
        </button>
        <a href="/docs" target="_blank" rel="noopener noreferrer" className="h-10 px-3 rounded-lg flex items-center gap-1.5 hover:bg-muted/80 dark:hover:bg-muted/30 transition-all duration-300 active:scale-95 border border-transparent hover:border-border text-foreground/80">
          <Code className="w-[18px] h-[18px]" />
          <span className="text-sm font-medium">API</span>
        </a>
        <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50 relative w-10 h-10 rounded-lg hover:bg-muted/80 dark:hover:bg-muted/30 transition-all duration-300 active:scale-95 border border-transparent hover:border-border">
          <Bell className="w-[18px] h-[18px] text-foreground/80" />
        </button>
      </div>
    </div>
  );
}
