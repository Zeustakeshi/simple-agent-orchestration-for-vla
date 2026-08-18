# MVP VLA Orchestrator — Kế hoạch triển khai

## Context

Anh có kiến trúc VLA Orchestrator v1: **Cloud Agent (LLM) định hướng, Edge giữ giới hạn cứng**. Cần dựng MVP gấp nhưng luồng chạy phải đúng y kiến trúc: `take_action` async, `check_status` blocking chỉ-đọc, hard limits nằm trong code edge chứ không giao cho LLM, safety interrupt độc lập mạng.

Thay vì cánh tay SO-101 thật, MVP chạy trên **LIBERO/MuJoCo**. Kết quả mong đợi: mở UI chat, gõ "bỏ hộp sữa vào giỏ", thấy agent phân rã → gọi tool → poll → xem ảnh → retry/replan, đồng thời thấy cửa sổ MuJoCo có cánh tay đang chạy.

### Khảo sát môi trường (đã verify chạy thật)

| Thành phần | Trạng thái |
|---|---|
| conda env `lerobot_arm` | py3.12, lerobot **0.6.1**, mujoco 3.8.1, robosuite 1.4.0, libero, mcp 1.29, fastapi, uvicorn, glfw, torch 2.11+cu |
| `lerobot/envs/libero.py` | **Có sẵn** class `LiberoEnv` (gym) + `LiberoProcessorStep` — không cần tự viết wrapper LIBERO |
| Suite `libero_object` | 10 task `"pick up {alphabet soup, cream cheese, salad dressing, bbq sauce, ketchup, tomato sauce, butter, milk, chocolate pudding, orange juice} and place it in the basket"` |
| Policy | `HuggingFaceVLA/smolvla_libero` đã có trong HF cache (**đã finetune LIBERO** → happy path thật sự xảy ra) |
| Env smoke test | `OffScreenRenderEnv` reset/step OK, trả `agentview_image` + `robot0_eye_in_hand_image` (256×256), `env.check_success()` OK, `sim.model._model` là `mujoco.MjModel` thật |
| GPU | RTX 3050 6GB — đủ cho SmolVLA (~450M) |
| Thiếu | `langgraph`, `langchain-openai`, `sse-starlette` → cài vào `lerobot_arm` (theo lựa chọn của anh) |

### Quyết định đã chốt
- Scenario: `libero_object` + `smolvla_libero`.
- Viewer: **cửa sổ OpenCV** (agentview + wrist) + **MJPEG stream** lên UI web. Không dùng `mujoco.viewer` để tránh xung đột EGL/GLFW cùng process với robosuite offscreen render.
- Một env duy nhất: `lerobot_arm`.
- LLM: anh tự điền `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` trong `.env` → code phải đọc cả 3 biến, không hardcode.

---

## Cấu trúc thư mục

```
mvp_vla/
├── .env.example              OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL / các port
├── README.md                 3 lệnh chạy
├── scripts/spike_policy.py   Task 0 — smoke test trước khi code
├── run_edge.sh  run_server.sh
├── edge_vla/                 MCP SERVER (chạy trong lerobot_arm)
│   ├── config.py             HARD LIMITS + đường dẫn
│   ├── sim_env.py            LIBERO env (tắt auto-reset) + frame buffer
│   ├── policy_runner.py      SmolVLA load 1 lần + inference 1 step
│   ├── safety.py             check mỗi step + emergency_stop
│   ├── verifier.py           check_success + detections
│   ├── task_store.py         task_id → state, thread-safe
│   ├── controller.py         ★ lõi async/retry/recovery
│   ├── viewer.py             cửa sổ OpenCV (main thread) + MJPEG
│   └── server.py             FastMCP streamable-http + entrypoint
├── server/                   CLOUD AGENT (MCP client)
│   ├── mcp_client.py         ClientSession bền + convert tool schema
│   ├── prompts.py            system prompt mã hoá "agent-side policy"
│   ├── graph.py              LangGraph agent + inject ảnh
│   └── main.py               FastAPI /chat (SSE) + serve UI
└── ui/index.html             1 file: chat + event log + <img> MJPEG
```

---

## Task 0 — Spike bắt buộc (làm trước tiên)

`scripts/spike_policy.py`, chạy headless trong `lerobot_arm`:
- Load `HuggingFaceVLA/smolvla_libero` theo đúng chuỗi của `lerobot/scripts/lerobot_eval.py:748-770`:
  `make_policy(...)` + `make_pre_post_processors(policy_cfg, pretrained_path=...)` với `preprocessor_overrides={"device_processor":{"device":"cuda"}}`.
- Chuỗi inference 1 step (copy từ `lerobot_eval.py:263-290`):
  `preprocess_observation(obs)` → gán `observation["task"] = [task_description]` → `LiberoProcessorStep` pipeline → `preprocessor` → `policy.select_action` → `postprocessor` → `.cpu().numpy()[0]` (shape 7).
- Chạy 200 step trên `libero_object` task 7 ("milk"), in `check_success()` và **step/s**.

**Vì sao bắt buộc:** `config.json` của model có `n_action_steps: 1`, `chunk_size: 50` → mặc định inference lại **mỗi step**, trên RTX 3050 sẽ rất chậm. Nếu spike cho thấy < 5 step/s thì set `policy.config.n_action_steps = 10` (replay action chunk, chỉ inference 1 lần / 10 step) qua biến `VLA_N_ACTION_STEPS`. Con số này quyết định K=50 chạy trong 5s hay 60s → ảnh hưởng trực tiếp cảm giác luồng poll trong UI.

---

## Edge VLA — MCP Server

### `config.py` — Hard limits (code cứng, KHÔNG cho LLM chỉnh)
```
MAX_RETRY = 3          MAX_POLL = 8         WAIT_CLAMP = (1, 15)
MAX_K = 200            TASK_TIMEOUT_S = 180
SUITE = "libero_object"   POLICY_REPO = "HuggingFaceVLA/smolvla_libero"
SAFETY_MAX_ACTUATOR_FORCE / SAFETY_MAX_JOINT_VEL / SAFETY_INJECT_FILE = /tmp/vla_inject_safety
```

### `sim_env.py`
- `class MvpLiberoEnv(lerobot.envs.libero.LiberoEnv)` — **chỉ override `step()`**: copy nguyên thân hàm ở `envs/libero.py:359-382` nhưng **bỏ dòng `self.reset()` khi terminated**. Auto-reset của lerobot sẽ phá luồng K-step có agent trong vòng lặp.
- Khởi tạo qua `lerobot.envs.libero._get_suite("libero_object")`, `obs_type="pixels_agent_pos"`, `observation_height/width=256`, `control_mode="relative"`, `control_freq=20`.
- `frames()` → dict `{agentview, wrist}` uint8 đã lật H/W (giống `LiberoEnv.render()` ở `libero.py:270-276`).
- `mj_state()` → eef_pos, gripper_qpos, joint_pos/vel, `sim.data.actuator_force` (cho safety).
- `switch_task(task_id)` → close + tạo lại env khi agent chọn object khác.
- `home_eef_pos` = eef_pos ghi lại ngay sau reset đầu tiên.

### `policy_runner.py`
Load **1 lần** lúc khởi động (không load lại mỗi task). Hai method: `reset()` (gọi `policy.reset()` để xoá action queue trước mỗi `take_action`) và `act(obs, task_text) -> np.ndarray(7,)` theo đúng chuỗi ở Task 0.

### `safety.py` — chạy **mỗi step**, độc lập mạng
`check(mj_state) -> (ok, reason)`:
- `max(|actuator_force|)` > ngưỡng → `"servo load"`
- `max(|joint_vel|)` > ngưỡng → `"joint velocity"`
- joint_pos ngoài `sim.model.jnt_range` → `"joint out of range"`
- **tồn tại file `/tmp/vla_inject_safety`** → trigger thủ công (để demo nhánh SAFETY_STOP một cách xác định — sim không có nhiệt độ servo thật)

Vi phạm → `emergency_stop()`: dừng vòng lặp ngay (không chờ hết K), giữ nguyên tư thế, ghi `SAFETY_STOP`, **không tự retry**.

### `verifier.py`
- `check_success()` → `env._env.check_success()` (predicate BDDL — ground truth, ~ms). Đây là bản MVP của khối "VERIFIER YOLO/classifier".
- `detections()` → toạ độ object đích + basket lấy từ raw_obs (`{obj}_1_pos`, `basket_1_pos`, `{obj}_1_to_robot0_eef_pos`) → agent có số liệu để suy luận khi replan.

### `task_store.py`
`dict[task_id] -> {status, step, total, success, images{agentview,wrist} base64-jpeg, detections, reason, safe_at_home, ts}`, bọc `threading.Lock`. Thêm state toàn cục: `current_task_id`, `busy`, `retry_count`, `poll_count`.

### `controller.py` — lõi async (điểm quan trọng nhất)

**`take_action(subgoal, k, libero_task_id=None)` — trả về NGAY (~10ms)**
1. Nếu `busy` → trả `{status: ROBOT_BUSY, current_task_id}`, không spawn.
2. Clamp `k` vào `[1, MAX_K]`. Resolve `libero_task_id`: dùng tham số nếu agent truyền, ngược lại fuzzy-match `subgoal` với 10 chuỗi `task.language`. Nếu khác task hiện tại → `switch_task` + reset `retry_count = 0`.
3. Tạo `task_id = uuid4()`, ghi store `RUNNING`, spawn `threading.Thread(daemon=True)`, return `{task_id, status: RUNNING}`.

**Thân thread nền**
```
policy.reset()
for i in range(k):
    ok, reason = safety.check(env.mj_state())
    if not ok:  -> emergency_stop(); store[SAFETY_STOP, reason, ảnh]; return
    if abort_flag or elapsed > TASK_TIMEOUT_S: -> store[TIMEOUT/ABORTED]; return
    a = policy.act(obs, task_text); obs = env.step(a)
    store.step = i+1;  viewer.publish(env.frames())     # UI thấy realtime
# VLA dừng -> "rút gripper": vài step no-op cho vật ổn định
for _ in range(5): env.step([0,0,0,0,0,0, last_gripper])
success = verifier.check_success()
store[DONE, success, images=capture(), detections=...]
if not success:
    retry_count += 1
    if retry_count >= MAX_RETRY:          # ← HARD LIMIT, edge tự xử lý
        recovery(); store[FAILED_MAX_RETRY, safe_at_home=True]
```
`recovery()` = mở gripper → lùi Z +10cm (action tương đối `dz>0`, ~15 step) → `go_home()`.

**`check_status(task_id, wait_s)` — `async def`, BLOCKING đúng `wait_s`**
- Clamp `wait_s` vào `[1, 15]`. `poll_count += 1`; nếu `poll_count > MAX_POLL` → abort task + trả `TIMEOUT`.
- Vòng `await asyncio.sleep(0.2)` cho tới khi hết `wait_s` **hoặc** status khác `RUNNING` (thoát sớm).
- Sau đó **chỉ ĐỌC** `task_store` — tuyệt đối không chạy lại verifier/capture ở đây.
- Vì là `async` nên `abort()` từ agent vẫn phục vụ được song song trong lúc đang chờ.

**`go_home()`** (sync ~2s): mở gripper → lùi Z lên → điều khiển tương đối tiến về `home_eef_pos`, tối đa 40 step. **Không dùng `env.reset()`** vì reset sẽ teleport cả object → mất trạng thái scene, làm luồng demo sai.

**`abort(task_id)`** (sync): bật cờ, thread thoát trong ≤1 step.
**`reset_episode()`** — *tool thêm ngoài kiến trúc*, cần để chạy lại demo mà không phải restart edge server.

### `viewer.py` + `server.py`
- Frame buffer 1 slot có lock, `publish(frames)` từ thread nền.
- **Main thread**: vòng `cv2.imshow("MVP VLA — LIBERO", hstack[agentview, wrist])` + overlay text `status | step/K | retry`. `cv2.waitKey(1)`.
- `server.py`: FastMCP (`mcp.server.fastmcp.FastMCP`) transport **streamable-http** trên `:8931`, mount vào FastAPI cùng route `GET /mjpeg` (`multipart/x-mixed-replace`). Chạy `uvicorn` trong **thread nền**, main thread giữ cửa sổ cv2 (bắt buộc — `cv2.imshow` phải ở main thread).
- 8 tool: `get_robot_state` (kèm danh sách 10 task LIBERO để agent chọn), `capture`, `take_action`, `check_status`, `check_success`, `go_home`, `abort`, `reset_episode`. Docstring mỗi tool ghi rõ SYNC/ASYNC/BLOCKING vì LLM đọc chính docstring này.
- Ảnh trả về: base64 JPEG (quality 70, resize 256) trong JSON.

---

## Server — Cloud Agent

### `mcp_client.py`
`streamablehttp_client` + `ClientSession` giữ sống trong FastAPI **lifespan** qua `AsyncExitStack`. `list_tools()` → convert sang OpenAI function schema (~40 dòng, không cần thêm dep `langchain-mcp-adapters`). `call_tool(name, args)` → tách phần JSON và phần ảnh base64.

### `prompts.py` — mã hoá "agent-side policy" từ kiến trúc
Bắt buộc nêu rõ trong system prompt:
- Mở đầu: `get_robot_state()` + `capture()` trước khi lập kế hoạch.
- Phân rã thành subgoal + điều kiện thành công + ước lượng K (gợi ý 40–80 cho pick-place).
- Sau `take_action` **bắt buộc** poll `check_status` với `wait_s` tăng dần 3 → 5 → 8; **không** gọi `take_action` mới khi chưa DONE.
- Bảng trạng thái xử lý: `DONE+success` → `go_home` → báo cáo; `DONE+!success` → **xem ảnh** rồi quyết định retry hay đổi cách; `FAILED_MAX_RETRY` → hỏi user, không tự retry; `SAFETY_STOP` → báo user ngay, **cấm** retry; `ROBOT_BUSY` → `check_status` trước.
- Nói tiếng Việt với user; tường thuật ngắn gọn từng bước.

### `graph.py` — LangGraph
`StateGraph(MessagesState)` với 2 node: `agent` (ChatOpenAI `.bind_tools`) và `tools`. Điểm cần làm đúng:
- Tool result trả về `ToolMessage` chứa JSON text.
- **Nếu result có ảnh** → node tools append thêm một `HumanMessage` với content block `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}` ngay sau ToolMessage. Đây là cách agent thật sự "xem ảnh để replan" — nếu bỏ qua bước này thì nhánh retry chỉ là đoán mò.
- `recursion_limit` cao (≥ 60) vì luồng poll tốn nhiều lượt.

### `main.py` — FastAPI
- `POST /chat {message, thread_id}` → **SSE** stream từ `graph.astream_events(version="v2")`, phát event: `agent_text` (token), `tool_call` (tên + args), `tool_result` (status + tóm tắt), `done`.
- `GET /` serve `ui/index.html`; `GET /health`. Checkpoint bằng `MemorySaver` để giữ hội thoại theo `thread_id`.

### `ui/index.html`
Một file, vanilla JS. Trái: ô chat + **event log realtime** tô màu theo loại (agent / tool_call / tool_result + badge màu theo `RUNNING / DONE / FAILED_MAX_RETRY / SAFETY_STOP`). Phải: `<img src="http://localhost:8931/mjpeg">` sim trực tiếp + ảnh `capture` gần nhất agent nhận được. Không cần đẹp — mục tiêu là verify luồng.

---

## Thứ tự thực hiện

1. **Task 0 spike** — chốt `n_action_steps`, xác nhận policy thật sự pick-place được.
2. `pip install langgraph langchain-openai sse-starlette` vào `lerobot_arm`, sau đó **kiểm tra lại `import lerobot, robosuite, transformers` vẫn OK** (rủi ro pip resolver đụng pydantic/httpx).
3. Edge: `config` → `sim_env` → `policy_runner` → `task_store` → `safety`/`verifier` → `controller` → `viewer`/`server`. Test edge độc lập bằng một script MCP client nhỏ trước khi nối agent.
4. Server: `mcp_client` → `prompts` → `graph` → `main`.
5. UI, rồi chạy end-to-end.

---

## Verification (chạy thật, không chỉ test)

| # | Nhánh kiến trúc | Cách kích hoạt | Kỳ vọng |
|---|---|---|---|
| 1 | Happy path | UI: "bỏ hộp sữa vào giỏ" | Cửa sổ cv2 có tay chạy; log: `take_action` → `check_status(3)` RUNNING 30/50 → `check_status(5)` **DONE success:true** → `go_home` → agent báo "Đã bỏ vào giỏ ✓" |
| 2 | Retry loop | Prompt agent chọn K nhỏ (~15) hoặc set `MAX_K=15` | `DONE success:false` ×3, mỗi lần agent xem ảnh rồi tự gọi lại `take_action` |
| 3 | FAILED_MAX_RETRY | tiếp nhánh 2 | Ở lần thứ 3 edge **tự** mở gripper → lùi Z → về home, trả `FAILED_MAX_RETRY` + `safe_at_home:true`; agent **hỏi user**, không tự retry |
| 4 | SAFETY_STOP | `touch /tmp/vla_inject_safety` giữa lúc chạy | Robot dừng ngay giữa chừng (không hết K), `SAFETY_STOP`, agent báo user và **không** retry |
| 5 | ROBOT_BUSY | script gọi `take_action` 2 lần liên tiếp | Lần 2 trả `ROBOT_BUSY`, không spawn thread thứ hai |
| 6 | Hard limit poll | script poll `check_status` 9 lần | Lần 9 trả `TIMEOUT` + task bị abort |
| 7 | wait clamp | gọi `check_status(wait_s=999)` | Trả về sau đúng ~15s |
| 8 | Async đúng nghĩa | đo thời gian `take_action` | < 100ms dù K=50 |

**Chạy:**
```
Terminal 1:  conda activate lerobot_arm && ./run_edge.sh     # hiện cửa sổ MuJoCo/cv2
Terminal 2:  conda activate lerobot_arm && ./run_server.sh   # FastAPI :8000
Browser:     http://localhost:8000
```

---

## Rủi ro đã nhận diện

- **Tốc độ inference** — quyết định bởi Task 0; nếu chậm thì tăng `n_action_steps`.
- **EGL trong thread nền** — robosuite tạo context EGL ở thread nào thì phải step ở thread đó. Vì vậy **toàn bộ `env.step` phải nằm trong đúng một worker thread duy nhất**; `capture`/`get_robot_state` gọi từ MCP thread chỉ được đọc frame buffer đã publish, không tự render.
- **pip install** có thể đụng deps của lerobot → bước 2 có kiểm tra lại import.
