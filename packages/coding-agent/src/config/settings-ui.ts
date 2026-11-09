<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: none (1 contested hunk(s), neither side deleted the other's lines)
import { TERMINAL } from "@tau/tau-tui";
import { SETTING_TABS, type SettingsDisplayEntry, type SettingsHost } from "@tau/tau-tui/overlays/settings-defs";
=======
import { TERMINAL } from "@oh-my-pi/pi-tui";
import { isNativeRendering } from "@oh-my-pi/pi-tui/native/state";
import { SETTING_TABS, type SettingsDisplayEntry, type SettingsHost } from "@oh-my-pi/pi-tui/overlays/settings-defs";
import { isSettingsInitialized, Settings, settings } from "./settings";
import { orderedSettings } from "./all-settings";
import { type AnySetting, lookup } from "./registry";

import { cfgPlanAutosave, cfgPlanEnabled } from "../plan-mode/settings";
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/config/settings-ui.ts' for per-hunk detail, 'weave check' to verify your resolution
import {
	cfgRetryUsageAwareFallback,
	cfgDefaultThinkingLevel,
	normalizeProviderMaxInFlightRequests,
	validateProviderMaxInFlightRequests,
} from "../session/settings";
import { cfgAutolearnEnabled } from "../autolearn/settings";
import { cfgMemoryBackend } from "../memory-backend/settings";
import { cfgComposerPredictions, cfgTuiVimMode } from "../modes/settings";
import { cfgAdvisorEnabled } from "../advisor/settings";
import { cfgContextFilesExtra } from "../session/context-settings";
import { cfgTaskPerCallModelAllow } from "../task/settings";
import { cfgToolsRestrictedFolders } from "../tools/settings";

/** Condition over the global settings; hidden (false) until they are initialized. */
function whenSettings(test: (settings: Settings) => boolean): () => boolean {
	return () => isSettingsInitialized() && test(Settings.instance);
}

const CONDITIONS: Record<string, () => boolean> = {
	macOS: () => process.platform === "darwin",
	hasImageProtocol: () => !!TERMINAL.imageProtocol,
	nativeRendering: () => isNativeRendering(),
	mnemotauActive: () => {
		try {
			return Settings.instance.get("memory.backend") === "mnemotau";
		} catch {
			return false;
		}
	},
	advisorEnabled: whenSettings(s => cfgAdvisorEnabled.get(s) === true),
	vimModeEnabled: whenSettings(s => cfgTuiVimMode.get(s) === true),
	composerPredictionsEnabled: whenSettings(s => cfgComposerPredictions.get(s) === true),
	hindsightActive: whenSettings(s => cfgMemoryBackend.get(s) === "hindsight"),
	mnemopiActive: whenSettings(s => cfgMemoryBackend.get(s) === "mnemopi"),
	autolearnActive: whenSettings(s => cfgAutolearnEnabled.get(s) === true),
	autoThinkingActive: whenSettings(s => cfgDefaultThinkingLevel.get(s) === "auto"),
	usageAwareFallbackEnabled: whenSettings(s => cfgRetryUsageAwareFallback.get(s) === true),
	planModeEnabled: whenSettings(s => cfgPlanEnabled.get(s)),
	planAutosaveEnabled: whenSettings(s => cfgPlanEnabled.get(s) && cfgPlanAutosave.get(s)),
	// These editors write the global layer; hide them so a project-supplied list is never promoted to global.
	contextFilesExtraNotProject: whenSettings(s => cfgContextFilesExtra.provenance(s) !== "project"),
	restrictedFoldersNotProject: whenSettings(s => cfgToolsRestrictedFolders.provenance(s) !== "project"),
	perCallModelAllowNotProject: whenSettings(s => cfgTaskPerCallModelAllow.provenance(s) !== "project"),
};

/** Description suffix telling the panel user that an environment variable is in play. */
function envNote(setting: AnySetting): string {
	if (!setting.envName || setting.envValue() === undefined) return "";
	return setting.envFallback
		? ` Unset, it falls back to $${setting.envName}.`
		: ` $${setting.envName} overrides this setting while it is set.`;
}

<<<<<<< ours — scope `declaration` in function `createSettingsHost` (S, confidence: medium)
// refused_by: statement_fold · collision: none (1 contested hunk(s), neither side deleted the other's lines)
/** Adapt the application schema and settings store to the terminal overlay. */
export function createSettingsHost(settingsInstance?: Settings): SettingsHost {
=======
/**
 * Adapt the application schema and settings store to the terminal overlay. The panel shows and
 * edits the value of the settings layers, never an environment-supplied one (so an env credential
 * is never pre-filled or written to config); descriptions note an active environment variable.
 */
export function createSettingsHost(): SettingsHost {
>>>>>>> theirs — scope `declaration`
	const entries: SettingsDisplayEntry[] = [];
	for (const tab of SETTING_TABS) {
		for (const setting of orderedSettings()) {
			const ui = setting.ui;
			if (ui?.tab !== tab) continue;
			const note = envNote(setting);
			entries.push({
				path: setting.id,
				type: setting.type,
				defaultValue: setting.default,
				ui: note ? { ...ui, description: `${ui.description}${note}` } : ui,
				enumValues: setting.enumValues,
				credential: setting.isCredential,
				condition: ui.condition ? CONDITIONS[ui.condition] : undefined,
			});
		}
	}
	const resolve = (path: string): AnySetting => {
		const setting = lookup(path);
		if (!setting) throw new Error(`Unknown setting: ${path}`);
		return setting;
	};
	return {
		entries,
<<<<<<< ours — scope `return {` in function `createSettingsHost` (S+F, confidence: low)
// refused_by: statement_fold · collision: `get: path => settings.get(path as SettingPath),` +1 more
		get: path => {
			try {
				return (settingsInstance ?? Settings.instance ?? settings).get(path as SettingPath);
			} catch {
				return getDefault(path as SettingPath);
			}
		},
		set: (path, value) =>
			(settingsInstance ?? Settings.instance ?? settings).set(path as SettingPath, value as never),
=======
		get: path => lookup(path)?.layered(settings),
		set: (path, value) => resolve(path).set(settings, value),
		unset: path => resolve(path).unset(settings),
>>>>>>> theirs — scope `return {`
		normalizeProviderLimits: normalizeProviderMaxInFlightRequests,
		validateProviderLimits: validateProviderMaxInFlightRequests,
	};
}
