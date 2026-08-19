# MVP VLA Orchestrator

Demo kiến trúc **VLA Orchestrator**: Cloud Agent (LLM) định hướng, Edge giữ giới hạn
cứng. Cloud Agent (LangGraph + LLM qua MCP) điều khiển một cánh tay robot THẬT
(SO-101/SO-100 follower) bằng policy **SmolVLA** (hoặc bất kỳ policy nào lerobot hỗ
trợ), qua giao thức MCP với `take_action` async + `check_status` polling. Xem chi
tiết kiến trúc trong [`PLAN.md`](PLAN.md).

Kết quả: mở UI web, gõ "bỏ hộp sữa vào giỏ" — agent phân rã việc, gọi tool, poll
trạng thái, xem ảnh camera để quyết định retry, đồng thời cánh tay thật chạy theo.

Robot thật KHÔNG có ground-truth thành công như bản mô phỏng — mọi quyết định
"xong chưa" hoàn toàn dựa vào agent tự xem ảnh camera.

## Yêu cầu hệ thống

- **Linux** (đã test), Python **3.12**.
- **GPU NVIDIA + CUDA** — SmolVLA (~450M tham số) chạy trên GPU. Đã test ổn trên
  RTX 3050 6GB. Không có GPU vẫn chạy được nhưng rất chậm (không khuyến khích).
- **Cánh tay SO-101/SO-100 follower** đã calibrate (theo hướng dẫn lerobot), kết nối
  qua USB serial (`/dev/ttyACM*`) — user cần nằm trong group `dialout` (hoặc chạy với
  quyền phù hợp) để có thể mở port.
- **1+ camera USB** (opencv-compatible) gắn theo policy đã train (ví dụ wrist + top).
- Policy đã huấn luyện sẵn (checkpoint local hoặc HuggingFace repo) — path khai báo
  trong `config.yaml`.
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

### 4. Cấu hình `.env` (LLM)

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

### 5. Cấu hình `config.yaml` (robot / camera / policy)

`config.yaml` ở root repo chứa TOÀN BỘ thông số phần cứng (không đưa vào `.env`).
Sửa trực tiếp file này theo máy của bạn — port robot, port từng camera, đường dẫn
policy checkpoint, `rename_map` (map tên camera robot -> tên camera policy đã train).
Ví dụ ứng với lệnh `lerobot-rollout` gốc:

```bash
lerobot-rollout --strategy.type=base \
    --policy.path=... --policy.empty_cameras=1 --policy.device=cuda \
    --robot.type=so101_follower --robot.port=/dev/ttyACM1 --robot.id=follower_arm \
    --task="pick up the sandwich and put it in the cart" \
    --robot.cameras='{"wrist": {...}, "top": {...}}' \
    --rename_map='{"observation.images.wrist": "observation.images.camera1", ...}'
```

đã có sẵn ánh xạ tương ứng trong `config.yaml` mẫu — chỉ cần chỉnh `robot.port`,
`robot.cameras.*.index_or_path`, và `policy.path` cho đúng máy bạn. Có thể trỏ tới
file khác qua biến môi trường `VLA_CONFIG=/path/to/other-config.yaml`.

**Ngưỡng an toàn** (`safety.max_step_deg`, `robot.max_relative_target` trong
`config.yaml`) là giá trị khởi điểm — PHẢI test tay ở tốc độ thấp trước khi chạy tự
động, vì robot thật không còn được kiểm chứng bằng mô phỏng nào.

## Chạy

Cần 2 terminal, cùng activate `lerobot_arm`:

```bash
# Terminal 1 — Edge: kết nối robot/camera thật, mở cửa sổ cv2, load policy
# (lần đầu ~1-2 phút để tải weight nếu policy.path là HuggingFace repo)
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
- **Không mở được `/dev/ttyACM*`**: kiểm tra `robot.port` trong `config.yaml` đúng
  chưa (`ls /dev/ttyACM*`), và user hiện tại có trong group `dialout` không
  (`sudo usermod -aG dialout $USER`, rồi đăng xuất/đăng nhập lại).
- **Camera không mở được / sai `index_or_path`**: kiểm tra `v4l2-ctl --list-devices`
  hoặc `ls /dev/video*`, sửa `robot.cameras.*.index_or_path` trong `config.yaml`.
- **Cửa sổ `cv2.imshow` không hiện**: cần chạy trực tiếp trên máy có màn hình hoặc
  X forwarding — chạy qua SSH thuần không có display sẽ lỗi.
- **Robot giật/chạy sai hướng ngay từ đầu**: giảm `safety.max_step_deg` và
  `robot.max_relative_target` trong `config.yaml`, test lại ở tốc độ thấp.
- **Hết VRAM**: giảm tải bằng cách đóng ứng dụng GPU khác; SmolVLA cần ~2-3GB VRAM.
- **`touch /tmp/vla_inject_safety`**: dùng để demo/test nhánh dừng khẩn cấp
  (SAFETY_STOP) — xoá file đó để robot chạy lại bình thường.

## Cấu trúc thư mục

```
mvp_vla/
├── .env.example               Mẫu biến môi trường (chỉ LLM — OPENAI_*)
├── config.yaml                 Cấu hình robot/camera/policy (port, cameras, path...)
├── requirements.txt            Dependency (trừ torch — cài riêng theo GPU)
├── run_edge.sh  run_server.sh  2 script chạy
├── scripts/spike_policy.py     Smoke test policy trên LIBERO (spike lịch sử, không
│                                dùng runtime robot thật — cần cài thêm lerobot[libero]
│                                nếu muốn chạy lại)
├── edge_vla/                   MCP SERVER (robot thật qua lerobot + policy + hard limits)
└── server/                     Cloud Agent (LangGraph + FastAPI + MCP client)
└── ui/index.html                Chat UI + event log + MJPEG live view
```

Chi tiết thiết kế từng module: xem [`PLAN.md`](PLAN.md).
