import { Play, Search } from "lucide-react";

export function TextToSpeechView() {
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
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] flex w-full rounded-md border bg-muted/30 px-3 py-2 text-base transition-[color,box-shadow] outline-none min-h-[320px] resize-none" 
            placeholder="Nhập văn bản bạn muốn chuyển thành giọng nói..." 
            spellCheck="false"
          ></textarea>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0 ký tự</span>
            <span>0 từ</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1"></div>
          <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md px-8 shadow-sm">
            <Play className="w-4 h-4 mr-1" />
            Tạo giọng đọc
          </button>
        </div>
      </div>
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="flex flex-col gap-2 flex-1">
          <div className="bg-muted text-muted-foreground h-9 items-center justify-center rounded-xl p-[3px] flex w-[calc(100%-1rem)] mx-2 mt-2">
            <button className="bg-card text-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-xl border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap shadow-sm">
              Giọng nói
            </button>
            <button className="inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-xl border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap hover:text-foreground">
              Phong cách
            </button>
            <button className="inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-xl border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap hover:text-foreground">
              Lịch sử
            </button>
          </div>
          <div className="flex-1 outline-none p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base bg-muted/30 transition-[color,box-shadow] outline-none pl-9 text-sm" 
                placeholder="Tìm giọng nói..." 
              />
            </div>
            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
              <p className="text-sm text-muted-foreground text-center py-6">Không tìm thấy giọng nói</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
