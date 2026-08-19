# MVP VLA Orchestrator

Demo kiến trúc **VLA Orchestrator**: Cloud Agent (LLM) định hướng, Edge giữ giới hạn
cứng. Cloud Agent (LangGraph + LLM qua MCP) điều khiển một cánh tay robot mô phỏng
trên **LIBERO/MuJoCo** bằng policy **SmolVLA**, qua giao thức MCP với `take_action`
async + `check_status` polling. Xem chi tiết kiến trúc trong [`PLAN.md`](PLAN.md).

Kết quả: mở UI web, gõ "bỏ hộp sữa vào giỏ" — agent phân rã việc, gọi tool, poll
trạng thái, xem ảnh để quyết định retry, đồng thời thấy cửa sổ MuJoCo có cánh tay
đang chạy thật.

## Yêu cầu hệ thống

- **Linux** (đã test), Python **3.12**.
- **GPU NVIDIA + CUDA** — SmolVLA (~450M tham số) chạy trên GPU. Đã test ổn trên
  RTX 3050 6GB. Không có GPU vẫn chạy được nhưng rất chậm (không khuyến khích).
- **~3GB dung lượng trống** + **mạng ổn định cho lần chạy đầu tiên** — LIBERO tự tải
  ~400MB asset 3D (scene/vật thể) về `~/.cache/libero`, và policy SmolVLA tự tải
  ~1.2GB weight về HuggingFace cache (`~/.cache/huggingface`) khi chạy lần đầu.
- Một **API key LLM hỗ trợ vision + tool-calling** kiểu OpenAI-compatible (OpenAI,
  OpenRouter, ...). **Bắt buộc phải hỗ trợ ảnh** — agent xem ảnh camera để quyết
  định retry/replan, model text-only sẽ lỗi giữa chừng.

## Cài đặt

### 1. Tạo môi trường

```bash
conda create -n lerobot_arm python=3.12 -y
conda activate lerobot_arm
```

### 2. Cài PyTorch (CUDA)

Cài theo đúng driver GPU của máy — chọn lệnh tương ứng tại
[pytorch.org/get-started](https://pytorch.org/get-started/locally/). Ví dụ máy dùng
CUDA 13:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130
```

Kiểm tra CUDA nhận GPU:

```bash
python -c "import torch; print(torch.cuda.is_available())"   # phải ra True
```

### 3. Cài phần còn lại

```bash
pip install -r requirements.txt
```

`lerobot[libero]` sẽ tự kéo theo LIBERO (package `hf-libero`), `robosuite==1.4.0`,
`mujoco`, `bddl`... — **không cần build LIBERO từ source thủ công**.

### 4. Cấu hình `.env`

```bash
cp .env.example .env
```

Điền vào `.env`:

```
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://openrouter.ai/api/v1     # hoặc để trống nếu dùng thẳng OpenAI
OPENAI_MODEL=...                                  # PHẢI là model hỗ trợ vision + tool-calling
```

> Model không hỗ trợ ảnh (vd nhiều model "free" trên OpenRouter) sẽ báo lỗi
> `404 - No endpoints found that support image input` ngay khi agent gọi `capture()`
> hoặc nhận ảnh kết quả từ `take_action`. Chọn model có vision, ví dụ
> `google/gemini-2.0-flash-001` hoặc `openai/gpt-4o-mini` qua OpenRouter.

### 5. Cài giao diện web

Giao diện là app Next.js trong [`ui/`](ui/), cần **Node 20+**:

```bash
cd ui && npm install && cd ..
```

## Chạy

Cần 3 terminal. Hai cái đầu activate `lerobot_arm`:

```bash
# Terminal 1 — Edge: mở cửa sổ MuJoCo/cv2, load SmolVLA (lần đầu ~1-2 phút để tải weight)
conda activate lerobot_arm
./run_edge.sh

# Terminal 2 — Cloud Agent: FastAPI :8000
conda activate lerobot_arm
./run_server.sh

# Terminal 3 — Giao diện web: Next.js :3000 (không cần conda)
./run_ui.sh
```

Mở trình duyệt: **http://localhost:3000**

> Cổng 8000 giờ chỉ còn là API — mở nó chỉ nhận được một dòng chỉ đường sang
> :3000. Trình duyệt không gọi thẳng :8000 hay :8931 bao giờ: Next chuyển tiếp
> `/chat`, `/go_home` và `/mjpeg` sang chúng (`ui/next.config.ts`), nhờ vậy mọi
> thứ cùng một origin và FastAPI không cần cấu hình CORS.

## Luồng sự kiện của `/chat`

`POST /chat` trả một luồng SSE. Giao diện dịch nó sang từ vựng riêng ở
`ui/lib/api/mvp-chat.ts` — muốn viết client khác thì đây là toàn bộ giao thức:

| Sự kiện | Payload | Ý nghĩa |
|---|---|---|
| `agent_text` | `{text}` | lời agent nói với người dùng |
| `agent_reasoning` | `{text}` | suy nghĩ nội bộ — giao diện xếp vào khối "Suy nghĩ" thu gọn, không trộn vào câu trả lời |
| `agent_message_end` | `{}` | model nói xong một tin nhắn |
| `tool_call` | `{id, name, args}` | agent quyết định gọi một tool MCP |
| `tool_result` | `{id, name, result}` | tool đó trả về |
| `done` | `{}` | lượt chạy kết thúc |

Model kiểu harmony (gpt-oss và một số bản trên Ollama Cloud) phát nguyên văn
token điều khiển `<|channel|>analysis<|message|>…` lẫn trong nội dung.
`server/harmony.py` tách chúng ngay trên luồng, nên `agent_text` chỉ còn lời nói
sạch còn phần nghĩ đi qua `agent_reasoning`. Kiểm chứng:
`python scripts/verify_harmony.py`.

## Sự cố thường gặp

- **`404 No endpoints found that support image input`**: model trong `.env` không
  hỗ trợ vision — đổi `OPENAI_MODEL`.
- **Treo/lỗi ở lần chạy đầu tiên**: đang tải asset LIBERO (~400MB) hoặc weight
  SmolVLA (~1.2GB) — cần mạng ổn định, đợi xong sẽ được cache lại cho lần sau.
- **Lỗi liên quan EGL/GLFW hoặc cửa sổ cv2 không hiện**: đảm bảo máy có driver GPU
  cho phép offscreen render (EGL) — set `MUJOCO_GL=egl` (đã set sẵn trong
  `run_edge.sh`). Nếu chạy qua SSH không có display, cửa sổ `cv2.imshow` sẽ lỗi —
  cần chạy trực tiếp trên máy có màn hình hoặc X forwarding.
- **Hết VRAM**: giảm tải bằng cách đóng ứng dụng GPU khác; SmolVLA cần ~2-3GB VRAM.
- **`touch /tmp/vla_inject_safety`**: dùng để demo/test nhánh dừng khẩn cấp
  (SAFETY_STOP) — xoá file đó để robot chạy lại bình thường.
- **Khung camera báo "Không nhận được luồng camera"**: `run_edge.sh` chưa chạy,
  hoặc đang chạy ở cổng khác `8931` — đặt `EDGE_BASE_URL` trong `ui/.env.local`.
- **Chat báo lỗi kết nối**: `run_server.sh` chưa chạy, hoặc ở cổng khác `8000` —
  đặt `AGENT_BASE_URL` trong `ui/.env.local`.
- **Các trang Bảng điều khiển / Nhật ký / Lịch chạy hiện dữ liệu lạ**: đúng như
  vậy — chúng chạy bằng dữ liệu mẫu vì backend chưa có API cho chúng. Chat và
  camera là hai phần chạy thật. Xem [`ui/README.md`](ui/README.md).

## Cấu trúc thư mục

```
mvp_vla/
├── .env.example               Mẫu biến môi trường
├── requirements.txt            Dependency (trừ torch — cài riêng theo GPU)
├── run_edge.sh  run_server.sh  Script chạy edge và cloud agent
├── scripts/spike_policy.py     Smoke test policy (Task 0)
├── scripts/verify_harmony.py   Kiểm chứng bộ tách kênh của luồng token
├── edge_vla/                   MCP SERVER (LIBERO/MuJoCo + SmolVLA + hard limits)
├── server/                     Cloud Agent (LangGraph + FastAPI + MCP client)
│   └── harmony.py              Tách suy nghĩ / lời nói khỏi luồng token model
├── ui/                         Giao diện web Next.js — xem ui/README.md
└── run_ui.sh                   Script chạy giao diện
```

Chi tiết thiết kế từng module: xem [`PLAN.md`](PLAN.md).
