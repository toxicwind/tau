import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { keyText } from "@tau/tau-coding-agent/extensibility/legacy-tau-coding-agent-shim";
import { getKeybindings, setKeybindings, type KeybindingsManager as TuiKeybindingsManager } from "@tau/tau-tui";
import { KeybindingsManager, setKeyHintPlatform } from "@tau/tau-tui/app-keybindings";

describe("legacy keyText", () => {
	let previous: TuiKeybindingsManager;

	beforeEach(() => {
		previous = getKeybindings();
		setKeyHintPlatform("linux");
	});

	afterEach(() => {
		setKeybindings(previous);
		setKeyHintPlatform(undefined);
	});

	it("formats the active binding for legacy extensions", () => {
		setKeybindings(KeybindingsManager.inMemory({ "app.tools.expand": "alt+e" }));

		expect(keyText("app.tools.expand")).toBe("Alt+E");
	});
});
