"""FastAPI Cloud Agent: POST /chat (SSE) + serve UI. `.env` cung cấp OPENAI_API_KEY /
OPENAI_BASE_URL / OPENAI_MODEL / EDGE_MCP_URL — không hardcode. ClientSession với
Edge MCP giữ sống suốt vòng đời app qua lifespan (AsyncExitStack trong MCPClient).
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .graph import RECURSION_LIMIT, build_graph
from .mcp_client import MCPClient

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EDGE_MCP_URL = os.environ.get("EDGE_MCP_URL", "http://localhost:8931/mcp")
UI_DIR = Path(__file__).resolve().parent.parent / "ui"

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
async def index():
    index_file = UI_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return HTMLResponse("<h1>MVP VLA</h1><p>ui/index.html chưa được tạo (Task 5).</p>")


def _tool_calls_of(message) -> list[dict]:
    return list(getattr(message, "tool_calls", None) or [])


@app.post("/chat")
async def chat(req: ChatRequest) -> EventSourceResponse:
    graph = _state["graph"]

    async def event_gen():
        config = {"configurable": {"thread_id": req.thread_id}, "recursion_limit": RECURSION_LIMIT}
        input_ = {"messages": [{"role": "user", "content": req.message}]}
        try:
            async for event in graph.astream_events(input_, config=config, version="v2"):
                kind = event["event"]

                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    text = chunk.content if isinstance(chunk.content, str) else ""
                    if text:
                        yield {"event": "agent_text", "data": json.dumps({"text": text}, ensure_ascii=False)}

                elif kind == "on_chain_end" and event["name"] == "agent":
                    output = event["data"].get("output") or {}
                    for msg in output.get("messages", []):
                        for call in _tool_calls_of(msg):
                            yield {
                                "event": "tool_call",
                                "data": json.dumps(
                                    {"name": call["name"], "args": call.get("args", {})}, ensure_ascii=False
                                ),
                            }

                elif kind == "on_chain_end" and event["name"] == "tools":
                    output = event["data"].get("output") or {}
                    for msg in output.get("messages", []):
                        if msg.__class__.__name__ == "ToolMessage":
                            try:
                                summary = json.loads(msg.content)
                            except (TypeError, json.JSONDecodeError):
                                summary = {"raw": msg.content}
                            yield {
                                "event": "tool_result",
                                "data": json.dumps({"name": msg.name, "result": summary}, ensure_ascii=False),
                            }
        finally:
            yield {"event": "done", "data": "{}"}

    return EventSourceResponse(event_gen())
