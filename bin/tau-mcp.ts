#!/usr/bin/env bun
/**
 * tau-mcp — stdio MCP server exposing Tau's coding agent capabilities.
 *
 * Connects via stdio for Thresher (:25127), Kappa, Rig, Zed, Claude, or any MCP client.
 *
 * Tools:
 *   - tau_prompt: execute an autonomous task or prompt with Tau in a workspace
 *   - tau_status: query Tau capabilities, available models, and tools
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { createAgentSession } from "../packages/coding-agent/src/sdk.ts";

const server = new McpServer({
  name: "tau-agent",
  version: "18.8.4",
});

server.tool(
  "tau_prompt",
  "Run an autonomous coding task with Tau in a workspace. Tau executes tools (read, write, edit, ast_grep, ast_edit, eval), verifies code, and returns the structured result.",
  {
    prompt: z.string().describe("Task, instruction, or goal for Tau to execute"),
    cwd: z.string().optional().describe("Working directory for the agent (defaults to process.cwd())"),
    model: z.string().optional().describe("Model override (e.g. 'qwen3.6-35b', 'nemotron', 'anthropic/claude-sonnet-4-6')"),
  },
  async ({ prompt, cwd, model }) => {
    const workdir = cwd ? path.resolve(cwd) : process.cwd();
    try {
      const { session } = await createAgentSession({
        cwd: workdir,
        ...(model ? { model } : {}),
      });

      let assistantOutput = "";
      const toolCalls: string[] = [];

      session.subscribe((event) => {
        if (event.type === "message_update") {
          if (event.assistantMessageEvent.type === "text_delta") {
            assistantOutput += event.assistantMessageEvent.delta;
          }
        } else if (event.type === "tool_execution_start") {
          toolCalls.push(event.toolName);
        }
      });

      await session.prompt(prompt);
      await session.dispose();

      const messages = session.state.messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const finalOutput = assistantOutput.trim() || String(lastAssistant?.content ?? "");

      return {
        content: [
          {
            type: "text",
            text: finalOutput || "Task completed.",
          },
        ],
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `tau execution failed: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "tau_status",
  "Query Tau agent status: working directory, available tools, and runtime version.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "ok",
              service: "tau-agent-mcp",
              version: "18.8.4",
              cwd: process.cwd(),
              node: process.version,
              bun: typeof Bun !== "undefined" ? Bun.version : undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("tau-mcp server running on stdio (tools: tau_prompt, tau_status)");
