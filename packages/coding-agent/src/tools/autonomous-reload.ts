import { watch as fsWatch, type FSWatcher } from "node:fs";

export interface WatchHandle {
	(): void;
}

export interface AutonomousReloadDeps {
	/** Ordered roots to watch. Evaluated lazily so a reload that changes the
	 *  root set (e.g. a newly installed plugin) is reflected on the next scan. */
	roots: () => readonly string[];
	/** Called once per settled burst of edits, after the debounce elapses. */
	onReload: () => Promise<void>;
	/** Injectable fs-watch factory. Defaults to a real `node:fs` watcher. */
	watch?: (root: string, onChange: () => void) => WatchHandle;
	/** Trailing-debounce window in ms. Default 250. */
	debounceMs?: number;
	/** Keep only edits that touch reload-worthy files (plugins, skills, tools,
	 *  source, not node_modules / lockfiles). Default accepts every filename. */
	isRelevant?: (filename: string) => boolean;
}

export interface AutonomousReloader {
	/** Start watching every current root. Safe to call again after `stop()`. */
	start(): void;
	/** Tear down every watcher and cancel any pending debounce. */
	stop(): void;
	/** True while at least one subscription is live. */
	readonly active: boolean;
}

const DEFAULT_DEBOUNCE_MS = 250;

export function createAutonomousReloader(deps: AutonomousReloadDeps): AutonomousReloader {
	const roots = deps.roots;
	const onReload = deps.onReload;
	const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const isRelevant = deps.isRelevant ?? (() => true);

	const handles = new Set<() => void>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let reloadInFlight = false;

	const flush = (): void => {
		timer = undefined;
		void onReload().finally(() => {
			reloadInFlight = false;
		});
	};

	const schedule = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(flush, debounceMs);
	};

	const onChange = (filename: string | null): void => {
		if (filename !== null && !isRelevant(filename)) return;
		if (reloadInFlight) return; // a reload is settling; drop edits until it lands
		schedule();
	};

	return {
		start(): void {
			if (handles.size > 0) return; // already watching
			for (const root of roots()) {
				if (!root) continue;
				let handle: WatchHandle;
				if (deps.watch) {
					handle = deps.watch(root, () => onChange(null));
				} else {
					const watcher: FSWatcher = fsWatch(root, (_event, filename) =>
						onChange(typeof filename === "string" ? filename : null),
					);
					handle = () => watcher.close();
				}
				handles.add(handle);
			}
		},
		stop(): void {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			for (const handle of handles) handle();
			handles.clear();
		},
		get active(): boolean {
			return handles.size > 0;
		},
	};
}
