"""LangGraph agent: node `agent` (ChatOpenAI + tool schema từ edge MCP) <-> node
`tools` (gọi thật edge MCP qua MCPClient.call_tool).

Điểm quan trọng đúng kiến trúc: nếu tool result có ảnh, node `tools` append thêm một
`HumanMessage` chứa content block ảnh NGAY SAU `ToolMessage` tương ứng — đây là cách
agent thật sự "xem ảnh" để quyết định retry/replan (PLAN.md, mục graph.py). Bỏ bước
này thì nhánh retry chỉ là đoán mò.
"""

from __future__ import annotations

import json
import os

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph

from .mcp_client import MCPClient
from .prompts import SYSTEM_PROMPT

RECURSION_LIMIT = 60


def _make_llm(tool_schemas: list[dict]) -> ChatOpenAI:
    llm = ChatOpenAI(
        model=os.environ["OPENAI_MODEL"],
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.environ.get("OPENAI_BASE_URL") or None,
        temperature=0,
        streaming=True,
    )
    return llm.bind_tools(tool_schemas)


async def build_graph(mcp_client: MCPClient):
    tool_schemas = await mcp_client.list_tools_openai()
    llm = _make_llm(tool_schemas)

    async def agent_node(state: MessagesState) -> dict:
        messages = state["messages"]
        if not any(isinstance(m, SystemMessage) for m in messages):
            messages = [SystemMessage(content=SYSTEM_PROMPT), *messages]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    async def tools_node(state: MessagesState) -> dict:
        last = state["messages"][-1]
        out: list = []
        for call in last.tool_calls:
            try:
                data, images = await mcp_client.call_tool(call["name"], call["args"])
            except Exception as exc:  # noqa: BLE001
                data, images = {"error": str(exc)}, {}
            out.append(
                ToolMessage(
                    content=json.dumps(data, ensure_ascii=False),
                    tool_call_id=call["id"],
                    name=call["name"],
                )
            )
            if images:
                content: list = [{"type": "text", "text": f"Ảnh mới nhất sau tool `{call['name']}`:"}]
                for cam_name, b64 in images.items():
                    content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        }
                    )
                out.append(HumanMessage(content=content))
        return {"messages": out}

    def should_continue(state: MessagesState) -> str:
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tools_node)
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile(checkpointer=MemorySaver())
