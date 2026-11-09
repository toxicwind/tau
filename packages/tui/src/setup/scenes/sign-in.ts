// refused_by: merge_ladder_exhausted · collision: `import type { OAuthPrompt, OAuthProvider } from "@oh-my-pi/pi-a…` +1 more
import type { AuthStorage } from "@tau/tau-ai";
import { PASTE_CODE_LOGIN_PROVIDERS } from "@tau/tau-ai";
import type { OAuthPrompt, OAuthProvider } from "@tau/tau-ai/oauth/types";
import { Container } from "../../tui";
import { Spacer } from "../../components/spacer";
import { Text } from "../../components/text";
import { WizardStep } from "../../components/wizard-step";
import { editorKey } from "../../chrome/keybinding-hints";
import { type SgrMouseEvent } from "../../mouse";
import { wrapTextWithAnsi } from "../../utils";
import { getAgentDbPath } from "@tau/tau-utils";
import { OAuthSelectorComponent } from "../../overlays/oauth-selector";
import { theme } from "../../theme/theme";
import { col, node, span } from "../../native/describe";
import type { DescribeContext, NativeChild, NativeNode } from "../../native/node";
import { Memo } from "../../native/memo";
import {
	SETUP_SHEET_ROLE,
	type SetupScene,
	type SetupSceneController,
	type SetupSceneHost,
	type StyledLine,
} from "./types";

const SCENE_TITLE = "Sign in to your providers";
/** Login dialog rows kept above a cut on short screens: top border, spacer, first sign-in link row. */
const DIALOG_HEAD_ROWS = 3;
const LIST_LEAD = "Pick a provider to sign in — you can connect more than one.";
/** The provider sheet's subtitle: its title and rows already say "pick a provider". */
const SHEET_LEAD = "You can connect more than one.";

/** The last finished sign-in (`provider` is the display name): shown on the provider sheet (natively) or under the list (ANSI). */
type SignInOutcome =
	| { readonly kind: "success"; readonly provider: string }
	| { readonly kind: "error"; readonly provider: string; readonly message: string };

/**
 * "Sign in" scene: lets the user authenticate one or more model providers via
 * OAuth. It never auto-advances the wizard — the user may sign in to several
 * providers and then leave the step with Esc.
 *
 * Picking is the provider selector (natively a setup sheet: Skip/Continue on
 * Esc, Sign in on Enter); signing in is the app's {@link LoginDialogComponent},
 * driven like `/login` drives it: natively its own sheet over the setup page,
 * in the cell grid drawn in the wizard body in place of the selector.
 */
export class SignInScene implements SetupSceneController {
	readonly title = SCENE_TITLE;
	get subtitle(): string {
		return `Sign in to one or more providers. Press ${editorKey("tui.select.cancel")} when you're done.`;
	}

	#authStorage: AuthStorage;
	#selector: OAuthSelectorComponent;
	/** The login flow on screen; undefined while picking. */
	#dialog: LoginDialogComponent | undefined;
	#outcome: SignInOutcome | undefined;
	/** A sign-in succeeded in this scene: leaving the step reads "Continue". */
	#signedIn = false;
	/** Aborts a running login when the scene goes away. */
	#lifetime = new AbortController();
	#step: WizardStep | undefined;
	#native = new Memo();

	readonly #host: SetupSceneHost;

	constructor(host: SetupSceneHost) {
		this.#host = host;
		this.#authStorage = host.ctx.authStorage;
		this.#selector = new OAuthSelectorComponent(
			"login",
			this.#authStorage,
			providerId => {
				void this.#login(providerId);
			},
			() => this.#host.finish(this.#signedIn ? "done" : "skipped"),
			{
				requestRender: () => this.#host.requestRender(),
				disabledProviders: this.#host.ctx.disabledProviders,
				sheet: this.#sheet(),
			},
		);
	}

	dispose(): void {
		this.#lifetime.abort();
		this.#selector.stopValidation();
		this.#dialog = undefined;
	}

	invalidate(): void {
		this.#native.clear();
		this.#step?.invalidate();
		this.#selector.invalidate();
		this.#dialog?.invalidate();
	}

	handleInput(data: string): void {
		if (this.#dialog) {
			this.#dialog.handleInput(data);
			return;
		}
		this.#selector.handleInput(data);
	}

	/** Forward mouse to the provider selector; the login dialog takes keys only. */
	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		if (this.#dialog) return;
		this.#step?.routeMouse(event, line, col);
	}

	render(width: number, maxLines?: number): readonly string[] {
		const dialog = this.#dialog;
		if (dialog) {
			// Short screens cut the middle: the head keeps the title and the first link row (every
			// wrapped URL row links the full URL), the tail the live step (code field, newest progress).
			const lines = dialog.render(width);
			if (maxLines === undefined || lines.length <= maxLines) return lines;
			const head = maxLines >= DIALOG_HEAD_ROWS * 2 ? DIALOG_HEAD_ROWS : 0;
			return [...lines.slice(0, head), ...lines.slice(lines.length - (maxLines - head))];
		}
		// Hint + blank cost two rows; the wizard subtitle already explains
		// this panel, so on short screens the rows go to the provider list
		// instead (17 = full selector: 4 chrome above, 10 rows, 3 below).
		let intro: Container | undefined;
		if (maxLines === undefined || maxLines >= 17 + 2) {
			intro = new Container();
			intro.addChild(new Text(theme.fg("muted", LIST_LEAD), 0, 0));
			intro.addChild(new Spacer(1));
		}
		const status = new Container();
		for (const line of this.#statusLines()) {
			for (const wrapped of wrapTextWithAnsi(theme.fg(line.color, line.text), width)) {
				status.addChild(new Text(wrapped, 0, 0));
			}
		}
		this.#step ??= new WizardStep({
			kind: "choice",
			content: this.#selector,
			gap: 0,
			fitContent: budget => {
				if (budget !== undefined) this.#selector.setMaxHeight(budget);
			},
		});
		this.#step.setIntro(intro);
		this.#step.setStatus(status);
		this.#step.setMaxHeight(maxLines);
		return this.#step.render(width);
	}

	/**
	 * Signing in: the login dialog (its own sheet). Picking: the provider
	 * selector, which presents the setup sheet where the terminal draws
	 * pickers; elsewhere it is an inline card under the lead and the outcome.
	 */
	describe(cx: DescribeContext): NativeNode {
		const dialog = this.#dialog;
		const sheet = cx.supports("picker");
		const outcome = this.#outcome;
		return this.#native.get([dialog, sheet, outcome, this.#selector], () => {
			if (dialog) return col([dialog]);
			if (sheet) return col([this.#selector]);
			const children: NativeChild[] = [
				node("text", { spans: [span(LIST_LEAD, "muted")] }, undefined, "intro"),
				this.#selector,
			];
			this.#statusLines().forEach((line, index) => {
				children.push(node("text", { spans: [span(line.text, line.color)] }, undefined, `status:${index}`));
			});
			return col(children, { gap: "sm", role: "omp.setup.sign-in" });
		});
	}

	/** The provider sheet: the step's copy, the last outcome above the action bar, and Skip until a sign-in succeeded. */
	#sheet(): OAuthSelectorSheet {
		const outcome = this.#outcome;
		let status: TspText | undefined;
		if (outcome?.kind === "success") {
			status = [
				span(`Signed in to ${outcome.provider}.`, "success"),
				span(" Add another provider or continue.", "muted"),
			];
		} else if (outcome?.kind === "error") {
			status = [span(`Couldn't sign in to ${outcome.provider}: ${outcome.message}`, "error")];
		}
		return {
			title: SCENE_TITLE,
			subtitle: SHEET_LEAD,
			role: SETUP_SHEET_ROLE,
			size: "lg",
			...(status ? { status } : {}),
			leave: { id: "skip", label: this.#signedIn ? "Continue" : "Skip" },
		};
	}

	/** The last outcome as status copy under the cell-grid list (and the inline native fallback). */
	#statusLines(): readonly StyledLine[] {
		const outcome = this.#outcome;
		if (!outcome) return [];
		if (outcome.kind === "success") {
			return [
				{ text: `${theme.status.success} Signed in to ${outcome.provider}`, color: "success" },
				{ text: `Credentials saved to ${getAgentDbPath()}`, color: "dim" },
			];
		}
		return [
			{ text: `Login failed: ${outcome.message}`, color: "error" },
			{
				text: `Choose another provider or press ${editorKey("tui.select.cancel")} to continue.`,
				color: "dim",
			},
		];
	}

	#setOutcome(outcome: SignInOutcome | undefined): void {
		this.#outcome = outcome;
		if (outcome?.kind === "success") this.#signedIn = true;
		this.#selector.setSheet(this.#sheet());
	}

	/** Back to the provider list (Esc in the dialog, or the flow settled). */
	#closeDialog(dialog: LoginDialogComponent): void {
		if (this.#dialog !== dialog) return;
		this.#dialog = undefined;
		this.#host.restoreFocus();
		this.#host.requestRender();
	}

	/** One provider's login, driven like `/login` drives the dialog; the outcome lands on the provider sheet. */
	async #login(providerId: string): Promise<void> {
		if (this.#dialog || this.#lifetime.signal.aborted) return;
		const ctx = this.#host.ctx;
		const useManualInput = PASTE_CODE_LOGIN_PROVIDERS.has(providerId);
		const name = getOAuthProviders().find(provider => provider.id === providerId)?.name ?? providerId;
		const dialog = new LoginDialogComponent(
			this.#host,
			providerId,
			// Fires on Esc: back to the list now; the aborted flow's rejection settles below.
			() => this.#closeDialog(dialog),
			url => ctx.openInBrowser(url),
		);
		this.#dialog = dialog;
		this.#setOutcome(undefined);
		this.#host.setFocus(dialog);
		this.#host.requestRender();
		try {
			await this.#authStorage.oauth.login(providerId as OAuthProvider, {
				signal: AbortSignal.any([dialog.signal, this.#lifetime.signal]),
				onBrowserSession: (request, signal) => ctx.captureBrowserSession(request, signal),
				onAuth: info => dialog.showAuth(info.url, info.instructions, info.launchUrl),
				onPrompt: prompt => dialog.showPrompt(prompt),
				onProgress: message => dialog.showProgress(message),
				onManualCodeInput: useManualInput
					? signal =>
							dialog.showManualInput(
								`Paste the authorization code (or full redirect URL), then press ${editorKey("tui.input.submit")}:`,
								signal,
							)
					: undefined,
			});
			// Provider-scoped online refresh so the just-persisted credential re-runs
			// discovery instead of reusing a fresh authoritative cache row (#5780).
			await ctx.refreshProvider(providerId);
			if (this.#lifetime.signal.aborted) return;
			this.#selector.refreshAuth();
			this.#setOutcome({ kind: "success", provider: name });
		} catch (error) {
			// A cancel (Esc in the dialog) is quiet: the list is already back.
			if (this.#lifetime.signal.aborted || dialog.signal.aborted) return;
			this.#setOutcome({
				kind: "error",
				provider: name,
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			if (!this.#lifetime.signal.aborted) this.#closeDialog(dialog);
		}
	}
}

/** Onboarding scene for provider sign-in. */
export const providersSetupScene: SetupScene = {
	id: "providers",
	title: SCENE_TITLE,
	step: "Sign in",
	minVersion: 1,
	mount: host => new SignInScene(host),
};
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/**
 * "Sign in" panel: lets the user authenticate one or more model providers via
 * OAuth. Unlike a standalone scene it never auto-advances the wizard — the user
 * may sign in to several providers and then continue with Esc.
 */
export class SignInTab implements SetupTab {
	readonly id = "sign-in";
	readonly label = "Sign in";

	#authStorage: AuthStorage;
	#selector: OAuthSelectorComponent;
	#statusLines: string[] = [];
	#authUrl: string | undefined;
	#authLaunchUrl: string | undefined;
	#prompt: PromptState | undefined;
	#promptResolve: ((value: string) => void) | undefined;
	#promptReject: ((error: Error) => void) | undefined;
	#promptAbortCleanup: (() => void) | undefined;
	#loginAbort: AbortController | undefined;
	#loggingInProvider: string | undefined;
	#disposed = false;
	#step: WizardStep | undefined;

	readonly #host: SetupSceneHost;

	constructor(host: SetupSceneHost) {
		this.#host = host;
		this.#authStorage = host.ctx.authStorage;
		this.#selector = this.#createSelector();
	}

	/** Modal while an OAuth flow is running so the scene won't switch tabs or finish. */
	get modal(): boolean {
		return this.#loggingInProvider !== undefined;
	}

	dispose(): void {
		this.#disposed = true;
		this.#selector.stopValidation();
		this.#loginAbort?.abort();
		this.#resolvePrompt("");
	}

	invalidate(): void {
		this.#step?.invalidate();
		this.#selector.invalidate();
		this.#prompt?.input.invalidate();
	}

	handleInput(data: string): void {
		if (this.#loggingInProvider) {
			if (this.#authUrl && (matchesKey(data, "alt+c") || (data === "c" && !this.#prompt))) {
				void this.#copyAuthUrl();
				return;
			}
			if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
				this.#loginAbort?.abort();
			}
			return;
		}
		this.#selector.handleInput(data);
	}

	/** Forward mouse to the provider selector; pointer is inert during an active login or code prompt. */
	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		if (this.#loggingInProvider || this.#prompt) return;
		this.#step?.routeMouse(event, line, col);
	}

	render(width: number, maxLines?: number): readonly string[] {
		// Hint + blank cost two rows; the wizard subtitle already explains
		// this panel, so on short screens the rows go to the provider list
		// instead (17 = full selector: 4 chrome above, 10 rows, 3 below).
		let intro: Container | undefined;
		if (this.#loggingInProvider === undefined && (maxLines === undefined || maxLines >= 17 + 2)) {
			intro = new Container();
			intro.addChild(
				new Text(theme.fg("muted", "Pick a provider to sign in — you can connect more than one."), 0, 0),
			);
			intro.addChild(new Spacer(1));
		}
		const tail = new Container();
		const urlLines = this.#authUrl ? wrapTextWithAnsi(theme.fg("dim", this.#authUrl), width) : [];
		if (this.#authUrl) {
			tail.addChild(
				new Text(theme.fg("accent", `Browser login: ${loginUrlLink(this.#authUrl)} ${loginCopyHint()}`), 0, 0),
			);
			// Keep one URL row above the prompt; repeat the complete wrapped URL
			// below so the input remains visible in the wizard's short viewport.
			if (urlLines[0]) tail.addChild(new Text(urlLines[0], 0, 0));
			if (this.#authLaunchUrl) {
				tail.addChild(
					new Text(theme.fg("dim", `Local shortcut (this machine only): ${this.#authLaunchUrl}`), 0, 0),
				);
			}
		}
		if (this.#prompt) {
			tail.addChild(new Text(theme.fg("warning", this.#prompt.message), 0, 0));
			if (this.#prompt.placeholder) {
				tail.addChild(new Text(theme.fg("dim", this.#prompt.placeholder), 0, 0));
			}
			tail.addChild(this.#prompt.input);
		}
		if (urlLines.length > 1) {
			for (const line of urlLines) {
				tail.addChild(new Text(line, 0, 0));
			}
		}
		for (const line of this.#statusLines) {
			for (const wrapped of wrapTextWithAnsi(line, width)) {
				tail.addChild(new Text(wrapped, 0, 0));
			}
		}
		if (!this.#step) {
			this.#step = new WizardStep({
				kind: "choice",
				content: this.#selector,
				gap: 0,
				fitContent: budget => {
					if (budget !== undefined) this.#selector.setMaxHeight(budget);
				},
			});
		}
		if (this.#loggingInProvider) {
			this.#step.setKind("async");
			this.#step.setHeading(new Text(theme.bold(`Signing in to ${this.#loggingInProvider}`), 0, 0));
			this.#step.setIntro(undefined);
			this.#step.setContent(tail);
			this.#step.setStatus(undefined);
		} else {
			this.#step.setKind("choice");
			this.#step.setHeading(undefined);
			this.#step.setIntro(intro);
			this.#step.setContent(this.#selector);
			this.#step.setStatus(tail);
		}
		this.#step.setMaxHeight(maxLines);
		return this.#step.render(width);
	}

	#createSelector(): OAuthSelectorComponent {
		return new OAuthSelectorComponent(
			"login",
			this.#authStorage,
			providerId => {
				void this.#login(providerId);
			},
			() => this.#host.finish("skipped"),
			{ requestRender: () => this.#host.requestRender(), disabledProviders: this.#host.ctx.disabledProviders },
		);
	}

	async #login(providerId: string): Promise<void> {
		if (this.#loggingInProvider || this.#disposed) return;
		const useManualInput = PASTE_CODE_LOGIN_PROVIDERS.has(providerId);
		this.#selector.stopValidation();
		this.#loggingInProvider = providerId;
		this.#statusLines = [theme.fg("dim", "Starting OAuth flow…")];
		this.#authUrl = undefined;
		this.#authLaunchUrl = undefined;
		this.#loginAbort = new AbortController();
		this.#host.restoreFocus();
		this.#host.requestRender();
		try {
			await this.#authStorage.oauth.login(providerId as OAuthProvider, {
				signal: this.#loginAbort.signal,
				onBrowserSession: (request, signal) => this.#host.ctx.captureBrowserSession(request, signal),
				onAuth: info => {
					// Store the full authorization URL as the primary copy/display
					// target: it works from any machine, including SSH boxes where
					// the TAU-hosted `launchUrl` would resolve against the user's
					// local browser and fail. The wizard render uses
					// `wrapTextWithAnsi`, so long URLs wrap across lines rather
					// than getting truncated — the RFC 7636 §4.3 PKCE-downgrade
					// bug that motivated `launchUrl` is unreachable through this
					// surface. `launchUrl` is still surfaced as an optional local
					// shortcut for wide-terminal local users.
					this.#authUrl = info.url;
					this.#authLaunchUrl = info.launchUrl && info.launchUrl !== info.url ? info.launchUrl : undefined;
					this.#statusLines = [];
					if (info.instructions) {
						this.#statusLines.push(theme.fg("warning", info.instructions));
					}
					if (useManualInput) {
						this.#statusLines.push(theme.fg("dim", "Paste the returned code or redirect URL when prompted."));
					}
					void this.#copyAuthUrl();
					this.#host.ctx.openInBrowser(info.url);
					this.#host.requestRender();
				},
				onPrompt: prompt => this.#showPrompt(prompt),
				onProgress: message => {
					this.#statusLines.push(theme.fg("dim", message));
					this.#host.requestRender();
				},
				onManualCodeInput: signal =>
					this.#showPrompt({ message: "Paste the authorization code (or full redirect URL):" }, signal),
			});
			// Provider-scoped online refresh so the just-persisted credential re-runs
			// discovery instead of reusing a fresh authoritative cache row (#5780).
			await this.#host.ctx.refreshProvider(providerId);
			if (this.#disposed) return;
			this.#statusLines = [
				theme.fg("success", `${theme.status.success} Signed in to ${providerId}`),
				theme.fg("dim", `Credentials saved to ${getAgentDbPath()}`),
			];
			this.#authUrl = undefined;
			this.#authLaunchUrl = undefined;
			this.#loggingInProvider = undefined;
			this.#loginAbort = undefined;
			this.#selector.stopValidation();
			this.#selector = this.#createSelector();
			this.#host.restoreFocus();
			this.#host.requestRender();
		} catch (error) {
			if (this.#disposed) return;
			if (this.#loginAbort?.signal.aborted) {
				this.#statusLines = [theme.fg("dim", "Login cancelled.")];
				this.#authUrl = undefined;
				this.#authLaunchUrl = undefined;
			} else {
				const message = error instanceof Error ? error.message : String(error);
				this.#statusLines = [
					theme.fg("error", `Login failed: ${message}`),
					theme.fg("dim", "Choose another provider or press Esc to continue."),
				];
				this.#authUrl = undefined;
				this.#authLaunchUrl = undefined;
			}
			this.#loggingInProvider = undefined;
			this.#loginAbort = undefined;
			this.#host.restoreFocus();
			this.#host.requestRender();
		}
	}

	async #copyAuthUrl(): Promise<void> {
		const url = this.#authUrl;
		if (!url) return;
		try {
			await this.#host.ctx.copyToClipboard(url);
		} catch {
			// Clipboard integration is best-effort; the full URL remains rendered below.
		}
		this.#host.requestRender();
	}

	#showPrompt(prompt: OAuthPrompt, signal?: AbortSignal): Promise<string> {
		this.#resolvePrompt("");
		if (signal?.aborted) {
			return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Login input cancelled"));
		}
		const input = new Input();
		input.mask = prompt.secret === true;
		const focusInput = new CopyablePromptInput(input, () => {
			void this.#copyAuthUrl();
		});
		const pending = Promise.withResolvers<string>();
		this.#promptResolve = pending.resolve;
		this.#promptReject = pending.reject;
		this.#prompt = { message: prompt.message, placeholder: prompt.placeholder, input: focusInput };
		if (signal) {
			const onAbort = () => {
				if (this.#promptReject !== pending.reject) return;
				this.#rejectPrompt(signal.reason instanceof Error ? signal.reason : new Error("Login input cancelled"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			this.#promptAbortCleanup = () => signal.removeEventListener("abort", onAbort);
		}
		input.onSubmit = value => {
			this.#resolvePrompt(value);
		};
		input.onEscape = () => {
			this.#loginAbort?.abort();
			this.#resolvePrompt("");
		};
		this.#host.setFocus(focusInput);
		this.#host.requestRender();
		return pending.promise;
	}

	#resolvePrompt(value: string): void {
		const resolve = this.#promptResolve;
		if (!resolve) return;
		this.#clearPrompt();
		resolve(value);
	}

	#rejectPrompt(error: Error): void {
		const reject = this.#promptReject;
		if (!reject) return;
		this.#clearPrompt();
		reject(error);
	}

	#clearPrompt(): void {
		this.#promptAbortCleanup?.();
		this.#promptAbortCleanup = undefined;
		this.#promptResolve = undefined;
		this.#promptReject = undefined;
		this.#prompt = undefined;
		this.#host.restoreFocus();
		this.#host.requestRender();
	}
}
