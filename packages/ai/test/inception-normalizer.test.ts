import { describe, it, expect } from "bun:test";
import { normalizeMangledMarkers } from "../src/dialect/inception";

// Build the mangled prefix via char codes to avoid any literal mangling in source.
const MP = String.fromCharCode(60) + String.fromCharCode(124) + "inc_tool_call_ml" + String.fromCharCode(124);
const MCP = String.fromCharCode(60) + String.fromCharCode(47) + String.fromCharCode(124) + "inc_tool_call_ml" + String.fromCharCode(124);

describe("normalizeMangledMarkers", () => {
  it("strips doubled root form", () => {
    expect(normalizeMangledMarkers(MP + MP + "_calls>")).toBe("<tool_calls>");
  });
  it("strips single-tag open prefix", () => {
    expect(normalizeMangledMarkers(MP + 'invoke name="glob">')).toBe('<invoke name="glob">');
  });
  it("strips single-tag close prefix", () => {
    expect(normalizeMangledMarkers(MCP + "invoke>")).toBe("</invoke>");
  });
  it("strips parameter tags", () => {
    const input = MP + 'parameter name="path" string="true">src/a.ts' + MCP + "parameter>";
    expect(normalizeMangledMarkers(input)).toBe('<parameter name="path" string="true">src/a.ts</parameter>');
  });
  it("leaves clean XML untouched", () => {
    const clean = '<tool_calls><invoke name="glob"><parameter name="path">src/a.ts</parameter></invoke></tool_calls>';
    expect(normalizeMangledMarkers(clean)).toBe(clean);
  });
});