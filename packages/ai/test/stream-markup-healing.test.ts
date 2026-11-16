import { describe, it, expect } from "bun:test";
import { StreamMarkupHealing } from "../src/utils/stream-markup-healing";

// Build the mangled prefix via char codes to avoid any literal mangling in source.
const MP = String.fromCharCode(60) + String.fromCharCode(124) + "inc_tool_call_ml" + String.fromCharCode(124);
const MCP = String.fromCharCode(60) + String.fromCharCode(47) + String.fromCharCode(124) + "inc_tool_call_ml" + String.fromCharCode(124);

describe("StreamMarkupHealing inception pattern", () => {
  it("heals mangled mercury markers into a tool call", () => {
    const healer = new StreamMarkupHealing({ pattern: "inception" });
    const mangled =
      MP + MP + "_calls>\n" +
      MP + 'invoke name="glob">\n' +
      MP + 'parameter name="path" string="true">src/a.ts' + MCP + "parameter>\n" +
      MCP + "invoke>\n" +
      "</tool_calls>";
    const events = healer.feedEvents(mangled);
    const calls = events.filter((e) => e.type === "toolCall");
    expect(calls.length).toBe(1);
    const call = calls[0];
    if (call.type === "toolCall") {
      expect(call.call.name).toBe("glob");
      expect(JSON.parse(call.call.arguments)).toEqual({ path: "src/a.ts" });
    }
  });

  it("reports section closed on </tool_calls>", () => {
    const healer = new StreamMarkupHealing({ pattern: "inception" });
    healer.feedEvents(MP + MP + "_calls>\n" + MP + 'invoke name="glob">' + MCP + "invoke>\n</tool_calls>");
    expect(healer.sectionClosed).toBe(true);
  });

  it("getStreamMarkupHealingPattern returns inception for inception class", async () => {
    const { getStreamMarkupHealingPattern } = await import("../src/utils/stream-markup-healing");
    const model = { identity: { class: "inception" } } as any;
    expect(getStreamMarkupHealingPattern(model)).toBe("inception");
  });
});