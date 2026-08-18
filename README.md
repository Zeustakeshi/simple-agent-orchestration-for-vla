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

## Chạy

Cần 2 terminal, cùng activate `lerobot_arm`:

```bash
# Terminal 1 — Edge: mở cửa sổ MuJoCo/cv2, load SmolVLA (lần đầu ~1-2 phút để tải weight)
conda activate lerobot_arm
./run_edge.sh

# Terminal 2 — Cloud Agent: FastAPI :8000
conda activate lerobot_arm
./run_server.sh
```

Mở trình duyệt: **http://localhost:8000**

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

## Cấu trúc thư mục

```
mvp_vla/
├── .env.example               Mẫu biến môi trường
├── requirements.txt            Dependency (trừ torch — cài riêng theo GPU)
├── run_edge.sh  run_server.sh  2 script chạy
├── scripts/spike_policy.py     Smoke test policy (Task 0)
├── edge_vla/                   MCP SERVER (LIBERO/MuJoCo + SmolVLA + hard limits)
└── server/                     Cloud Agent (LangGraph + FastAPI + MCP client)
└── ui/index.html                Chat UI + event log + MJPEG live view
```

Chi tiết thiết kế từng module: xem [`PLAN.md`](PLAN.md).
