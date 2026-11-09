import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-co…` +1 more
import { resetSettingsForTest, Settings } from "tau/config/settings";
import { SelectorController } from "tau/modes/controllers/selector-controller";
import { AgentStorage } from "tau/session/agent-storage";
import { getProjectAgentDir, TempDir } from "@tau/tau-utils";
=======
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentStorage } from "@oh-my-pi/pi-coding-agent/session/agent-storage";
import { getProjectAgentDir, TempDir } from "@oh-my-pi/pi-utils";
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/test/autocomplete-max-visible.test.ts' for per-hunk detail, 'weave check' to verify your resolution
import { YAML } from "bun";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

import { cfgAutocompleteMaxVisible } from "@oh-my-pi/pi-coding-agent/modes/settings";

describe("autocompleteMaxVisible setting", () => {
	let settingsState: SettingsTestState | undefined;
	let tempDir: TempDir;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		settingsState = beginSettingsTest();
		tempDir = TempDir.createSync("@test-autocomplete-settings-");
		agentDir = path.join(tempDir.path(), "agent");
		projectDir = path.join(tempDir.path(), "project");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(getProjectAgentDir(projectDir), { recursive: true });
	});

	afterEach(async () => {
		AgentStorage.close();
		restoreSettingsTestState(settingsState);
		settingsState = undefined;
		if (tempDir) {
			try {
				await tempDir.remove();
			} catch {}
			tempDir = undefined as unknown as TempDir;
		}
	});

	it("should read from config.yml", async () => {
		await Bun.write(path.join(agentDir, "config.yml"), YAML.stringify({ autocompleteMaxVisible: 15 }, null, 2));
		const settings = await Settings.init({ cwd: projectDir, agentDir });
		expect(cfgAutocompleteMaxVisible.get(settings)).toBe(15);
	});
});
