"""One-time import of vivibe_voices/ into backend/data/voices.json.

For each voice:
  - copies the original ViVibe preview clip into assets/ref_audio/ (used as
    the ref_audio source for cloning — kept untouched, original transcript known)
  - generates a NEW preview sample whose script matches the voice's tags
    (tin tức -> news bulletin, podcast -> podcast intro, etc.) instead of the
    generic "xin chào, tôi là <tên>" ViVibe used, so the preview actually
    demonstrates the voice's intended use case
  - appends a `type: "cloned"` entry to voices.json (does not touch existing entries)

Run once: python backend/scripts/import_vivibe_voices.py
"""
import json
import re
import sys
import time
from pathlib import Path

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import torch
import numpy as np
import soundfile as sf

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
sys.path.append(str(BACKEND_DIR))

from models.omnivoice_wrapper import OmniVoiceWrapper  # noqa: E402

VIVIBE_DIR = REPO_ROOT / "vivibe_voices"
METADATA_PATH = VIVIBE_DIR / "metadata.json"
DOWNLOADS_DIR = VIVIBE_DIR / "downloads"
VOICES_PATH = BACKEND_DIR / "data" / "voices.json"
REF_AUDIO_DIR = REPO_ROOT / "assets" / "ref_audio"
SAMPLES_DIR = REPO_ROOT / "assets" / "samples"

# Same template downloader.py used to request each ViVibe preview — reconstructing
# it gives us the exact transcript of the reference clip, so cloning doesn't need
# OmniVoice's own (currently broken on this machine) auto-transcription.
def rebuild_ref_text(name: str, description: str) -> str:
    desc_clean = (description or "").replace("\n", " ").strip()
    if len(desc_clean) > 80:
        desc_clean = desc_clean[:80] + "..."
    return f"Xin chào, đây là bản thử nghiệm giọng nói của tôi trên nền tảng Vi Vibe. Tôi là {name}. {desc_clean}"

# Ordered most-specific-first: a voice may carry several tags, first match decides
# which sample script best demonstrates it.
CATEGORY_PRIORITY = [
    ("tin tức", "tin_tuc"),
    ("tổng đài", "tong_dai"),
    ("đọc thơ", "doc_tho"),
    ("quảng cáo", "quang_cao"),
    ("tvc", "quang_cao"),
    ("dẫn chương trình", "dan_chuong_trinh"),
    ("thuyết minh", "thuyet_minh"),
    ("đọc truyện", "ke_chuyen"),
    ("đọc sách", "ke_chuyen"),
    ("sách nói", "ke_chuyen"),
    ("tiểu thuyết", "ke_chuyen"),
    ("kể chuyện", "ke_chuyen"),
    ("lồng tiếng", "long_tieng"),
    ("podcast", "podcast"),
    ("review", "review"),
    ("vlog", "vlog"),
    ("vj", "vlog"),
    ("giải trí", "vlog"),
]

SAMPLE_TEXTS = {
    "tin_tuc": "Bản tin thời sự: sáng nay, Ngân hàng Nhà nước công bố điều chỉnh lãi suất điều hành, dự kiến tác động đáng kể đến thị trường bất động sản trong quý tới.",
    "tong_dai": "Xin chào quý khách, quý khách đã gọi đến tổng đài chăm sóc khách hàng, vui lòng chờ trong giây lát để được kết nối với nhân viên hỗ trợ.",
    "doc_tho": "Quê hương là chùm khế ngọt, cho con trèo hái mỗi ngày, quê hương là đường đi học, con về rợp bướm vàng bay.",
    "quang_cao": "Bạn đang tìm kiếm giải pháp hoàn hảo cho ngôi nhà của mình? Sản phẩm này chính là lựa chọn không thể bỏ qua, với ưu đãi đặc biệt chỉ trong tuần này.",
    "dan_chuong_trinh": "Xin kính chào quý vị khán giả đã đến với chương trình của chúng tôi ngày hôm nay, sau đây xin mời quý vị cùng theo dõi phần tiếp theo.",
    "thuyet_minh": "Được hình thành cách đây hàng triệu năm, dãy núi này là một trong những kỳ quan thiên nhiên ấn tượng nhất còn tồn tại đến ngày nay.",
    "ke_chuyen": "Ngày xửa ngày xưa, ở một ngôi làng nhỏ ven sông, có một cô bé luôn mơ ước được đi khắp thế gian để khám phá những điều kỳ diệu.",
    "long_tieng": "Anh không thể tin được chuyện này lại xảy ra... chúng ta phải tìm cách ngăn chặn trước khi quá muộn.",
    "podcast": "Chào mừng các bạn đã quay trở lại với podcast của chúng tôi, hôm nay chúng ta sẽ cùng trò chuyện về một chủ đề rất thú vị.",
    "review": "Chào mọi người, hôm nay mình sẽ review chi tiết sản phẩm này, từ thiết kế, tính năng cho đến trải nghiệm thực tế sau một tuần sử dụng.",
    "vlog": "Chào cả nhà, lại là mình đây, hôm nay mình sẽ dẫn mọi người đi khám phá một góc phố cực chill mà mình mới tìm ra gần đây.",
    "default": "Đây là một đoạn văn bản mẫu để bạn nghe rõ chất giọng, ngữ điệu và cảm xúc tự nhiên của giọng đọc này.",
}

SAMPLE_TEXTS_EN = {
    "default": "Hello, this is a sample recording so you can hear the tone, pacing and natural emotion of this voice.",
}

def pick_category(tags):
    tagset = set(tags)
    for tag, category in CATEGORY_PRIORITY:
        if tag in tagset:
            return category
    return "default"

def pick_sample_text(tags):
    # A voice tagged "tiếng Anh" is an English voice — reading it a Vietnamese
    # script would be a language mismatch, not just a style mismatch.
    if "tiếng Anh" in tags:
        return SAMPLE_TEXTS_EN["default"]
    return SAMPLE_TEXTS[pick_category(tags)]

def clean_filename(name):
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()

def main():
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    voices = json.loads(VOICES_PATH.read_text(encoding="utf-8"))
    REF_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"Loading OmniVoice once (device={device})...")
    from omnivoice import OmniVoice
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=dtype)

    used_slugs = {}
    new_entries = []
    failed = []

    items = list(metadata.items())
    for i, (voice_id, entry) in enumerate(items, 1):
        name = entry["name"]
        slug = entry.get("slug") or clean_filename(name).lower().replace(" ", "-")
        used_slugs[slug] = used_slugs.get(slug, 0) + 1
        final_slug = slug if used_slugs[slug] == 1 else f"{slug}-{used_slugs[slug]}"

        src_wav = DOWNLOADS_DIR / f"{clean_filename(name)}.wav"
        if not src_wav.exists():
            print(f"[{i}/{len(items)}] SKIP {name}: nguồn không tồn tại {src_wav}")
            failed.append(name)
            continue

        ref_audio_dest = REF_AUDIO_DIR / f"vivibe_{final_slug}.wav"
        ref_audio_dest.write_bytes(src_wav.read_bytes())

        ref_text = rebuild_ref_text(name, entry.get("description", ""))
        category = "english" if "tiếng Anh" in entry.get("tags", []) else pick_category(entry.get("tags", []))
        sample_text = pick_sample_text(entry.get("tags", []))

        print(f"[{i}/{len(items)}] {name} -> category={category}")
        try:
            with torch.no_grad():
                audio = model.generate(
                    text=sample_text,
                    ref_audio=str(ref_audio_dest),
                    ref_text=ref_text,
                )[0]
            sample_dest = SAMPLES_DIR / f"vivibe_{final_slug}.wav"
            audio_int16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
            sf.write(str(sample_dest), audio_int16, 24000, subtype="PCM_16")
        except Exception as e:
            print(f"  LỖI sinh preview cho {name}: {e}")
            failed.append(name)
            continue

        tags = list(entry.get("tags", [])) + ["cong_dong"]
        gender = "Nữ" if "nữ" in entry.get("tags", []) else ("Nam" if "nam" in entry.get("tags", []) else "")

        new_entries.append({
            "id": f"vivibe_{final_slug}",
            "name": name,
            "type": "cloned",
            "gender": gender,
            "description": entry.get("description", ""),
            "refAudio": f"assets/ref_audio/vivibe_{final_slug}.wav",
            "refText": ref_text,
            "tags": tags,
            "sampleUrl": f"/assets/samples/vivibe_{final_slug}.wav",
        })

    voices.extend(new_entries)
    VOICES_PATH.write_text(json.dumps(voices, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nXong: {len(new_entries)} giọng import thành công, {len(failed)} lỗi.")
    if failed:
        print("Lỗi:", ", ".join(failed))
    print(f"Tổng voices.json hiện có: {len(voices)}")

if __name__ == "__main__":
    main()
