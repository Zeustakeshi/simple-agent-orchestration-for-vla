"""MCP client bền cho Edge VLA, giữ sống qua FastAPI lifespan (AsyncExitStack).

`list_tools_openai()` convert schema MCP -> OpenAI function-calling (dùng bởi
`ChatOpenAI.bind_tools`). `call_tool()` tách phần JSON (structuredContent, vì mọi
tool edge trả `-> dict`) khỏi phần ảnh base64 (key "images") để không lặp base64
vào lịch sử hội thoại dạng text.
"""

from __future__ import annotations

import json
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


class MCPClient:
    def __init__(self, url: str):
        self.url = url
        self._stack = AsyncExitStack()
        self.session: ClientSession | None = None

    async def connect(self) -> None:
        read, write, _ = await self._stack.enter_async_context(streamablehttp_client(self.url))
        self.session = await self._stack.enter_async_context(ClientSession(read, write))
        await self.session.initialize()

    async def close(self) -> None:
        await self._stack.aclose()

    async def list_tools_openai(self) -> list[dict[str, Any]]:
        assert self.session is not None
        result = await self.session.list_tools()
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": tool.inputSchema,
                },
            }
            for tool in result.tools
        ]

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
        """Trả (json_result, images). images = {"agentview": b64jpeg, "wrist": b64jpeg}
        đã bị pop khỏi json_result."""
        assert self.session is not None
        result = await self.session.call_tool(name, arguments)

        if result.structuredContent is not None:
            data: dict[str, Any] = dict(result.structuredContent)
        else:
            text = "".join(block.text for block in result.content if block.type == "text")
            data = json.loads(text) if text else {}

        images = data.pop("images", None) or {}
        if result.isError:
            data.setdefault("error", True)
        return data, images
