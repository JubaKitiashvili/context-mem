"""context-mem integration with CrewAI via MCP."""

from crewai import Agent, Task, Crew
from crewai.tools import MCPServerAdapter

# context-mem MCP server
context_mem = MCPServerAdapter(
    server_params={
        "command": "npx",
        "args": ["-y", "context-mem", "serve"],
    }
)

# Agent with context-mem tools
researcher = Agent(
    role="Researcher",
    goal="Research and analyze with optimized context",
    tools=context_mem.tools,
)

task = Task(
    description="Search and analyze project context",
    agent=researcher,
)

crew = Crew(agents=[researcher], tasks=[task])
crew.kickoff()
