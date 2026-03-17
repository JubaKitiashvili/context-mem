"""context-mem integration with LangChain via MCP adapter."""

from langchain_mcp_adapters.client import MultiServerMCPClient

# Connect to context-mem MCP server
async def get_context_mem_tools():
    async with MultiServerMCPClient(
        {
            "context-mem": {
                "command": "npx",
                "args": ["-y", "context-mem", "serve"],
                "transport": "stdio",
            }
        }
    ) as client:
        tools = client.get_tools()
        return tools
