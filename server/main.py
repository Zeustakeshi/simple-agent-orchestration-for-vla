"""FastAPI Cloud Agent: POST /chat (SSE) + POST /go_home. `.env` cung cấp OPENAI_API_KEY /
OPENAI_BASE_URL / OPENAI_MODEL / EDGE_MCP_URL — không hardcode. ClientSession với
Edge MCP giữ sống suốt vòng đời app qua lifespan (AsyncExitStack trong MCPClient).
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .graph import RECURSION_LIMIT, build_graph
from .harmony import ChannelSplitter
from .mcp_client import MCPClient

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EDGE_MCP_URL = os.environ.get("EDGE_MCP_URL", "http://localhost:8931/mcp")
UI_URL = os.environ.get("UI_URL", "http://localhost:3000")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = MCPClient(EDGE_MCP_URL)
    await client.connect()
    _state["mcp_client"] = client
    _state["graph"] = await build_graph(client)
    logger.info("Connected to edge MCP tại %s, graph đã sẵn sàng", EDGE_MCP_URL)
    try:
        yield
    finally:
        await client.close()


app = FastAPI(title="MVP VLA Cloud Agent", lifespan=lifespan)


class ChatRequest(BaseModel):
    message: str
    thread_id: str = "default"


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.post("/go_home")
async def go_home() -> JSONResponse:
    """Gọi thẳng tool `go_home` qua MCP, bỏ qua LLM agent (nút thủ công trên UI)."""
    client: MCPClient = _state["mcp_client"]
    data, _images = await client.call_tool("go_home", {})
    return JSONResponse(data)


@app.get("/")
async def index() -> JSONResponse:
    """Chỉ đường sang UI. Trước đây route này serve `ui/index.html` — một file
    HTML tĩnh duy nhất. Giao diện giờ là app Next.js chạy tiến trình riêng ở
    :3000 và tự chuyển tiếp `/chat`, `/go_home`, `/mjpeg` về đây (`ui/next.config.ts`),
    nên process này chỉ còn là API. Trả một câu chỉ đường thay vì 404, vì
    http://localhost:8000 là địa chỉ mọi tài liệu cũ đều ghi."""
    return JSONResponse(
        {
            "service": "MVP VLA Cloud Agent",
            "ui": UI_URL,
            "message": f"Giao diện web đã chuyển sang {UI_URL} (chạy ./run_ui.sh).",
            "endpoints": ["POST /chat", "POST /go_home", "GET /health"],
        }
    )


def _tool_calls_of(message) -> list[dict]:
    return list(getattr(message, "tool_calls", None) or [])


def _sse(event: str, payload: dict) -> dict:
    return {"event": event, "data": json.dumps(payload, ensure_ascii=False)}


def _chunk_text(chunk) -> str:
    """Phần chữ của một chunk, dù provider trả `str` hay danh sách content block.

    Ollama/OpenRouter đôi khi trả `content` là list `[{"type": "text", ...}]`;
    bản trước chỉ đọc nhánh `str` nên với những provider đó câu trả lời im lặng
    biến mất khỏi giao diện.
    """
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "".join(parts)
    return ""


def _chunk_reasoning(chunk) -> str:
    """Suy nghĩ mà provider trả về trong một TRƯỜNG RIÊNG, không trộn vào content.

    Đây là đường đi "sạch" (OpenRouter `reasoning`, một số bản Ollama
    `reasoning_content`). Model harmony thì không dùng đường này — chúng nhét
    suy nghĩ thẳng vào `content` kèm token `<|channel|>`, và đó là việc của
    `ChannelSplitter`.
    """
    extra = getattr(chunk, "additional_kwargs", None) or {}
    for key in ("reasoning_content", "reasoning", "thinking"):
        value = extra.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


@app.post("/chat")
async def chat(req: ChatRequest) -> EventSourceResponse:
    """Luồng SSE của một lượt agent.

    Sự kiện phát ra (giao diện đọc ở `ui/lib/api/mvp-chat.ts`):

        agent_text        {text}              lời nói với người dùng
        agent_reasoning   {text}              suy nghĩ nội bộ, giao diện xếp
                                              vào khối "Suy nghĩ" thu gọn
        agent_message_end {}                  model đã nói xong một tin nhắn
        tool_call         {id, name, args}    agent quyết định gọi một tool
        tool_result       {id, name, result}  tool đó trả về
        done              {}                  lượt chạy kết thúc

    `id` là `tool_call_id` THẬT của LangChain. Trước đây backend không gửi nó,
    nên giao diện phải tự ghép cặp call↔result bằng hàng đợi FIFO theo tên —
    đúng khi tool chạy tuần tự, nhưng sai ngay khi model gọi song song hai lần
    cùng một tool. Gửi id thì phép ghép hết phải đoán.
    """
    graph = _state["graph"]

    async def event_gen():
        config = {"configurable": {"thread_id": req.thread_id}, "recursion_limit": RECURSION_LIMIT}
        input_ = {"messages": [{"role": "user", "content": req.message}]}
        splitter = ChannelSplitter()
        try:
            async for event in graph.astream_events(input_, config=config, version="v2"):
                kind = event["event"]

                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]

                    reasoning = _chunk_reasoning(chunk)
                    if reasoning:
                        yield _sse("agent_reasoning", {"text": reasoning})

                    for part, text in splitter.feed(_chunk_text(chunk)):
                        if not text:
                            continue
                        yield _sse("agent_reasoning" if part == "reasoning" else "agent_text", {"text": text})

                elif kind == "on_chat_model_end":
                    # Chốt phần đuôi còn giữ trong bộ tách, rồi đóng tin nhắn.
                    # Không chốt thì mẩu chữ cuối — thường là cả câu kết —
                    # nằm lại trong buffer và không bao giờ ra tới màn hình.
                    for part, text in splitter.flush():
                        if not text:
                            continue
                        yield _sse("agent_reasoning" if part == "reasoning" else "agent_text", {"text": text})
                    splitter.reset()
                    yield _sse("agent_message_end", {})

                elif kind == "on_chain_end" and event["name"] == "agent":
                    output = event["data"].get("output") or {}
                    for msg in output.get("messages", []):
                        for call in _tool_calls_of(msg):
                            yield _sse(
                                "tool_call",
                                {
                                    "id": call.get("id") or "",
                                    "name": call["name"],
                                    "args": call.get("args", {}),
                                },
                            )

                elif kind == "on_chain_end" and event["name"] == "tools":
                    output = event["data"].get("output") or {}
                    for msg in output.get("messages", []):
                        if msg.__class__.__name__ == "ToolMessage":
                            try:
                                summary = json.loads(msg.content)
                            except (TypeError, json.JSONDecodeError):
                                summary = {"raw": msg.content}
                            yield _sse(
                                "tool_result",
                                {
                                    "id": getattr(msg, "tool_call_id", "") or "",
                                    "name": msg.name,
                                    "result": summary,
                                },
                            )
        finally:
            yield {"event": "done", "data": "{}"}

    return EventSourceResponse(event_gen())
