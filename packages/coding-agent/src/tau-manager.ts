import { stat } from 'node:fs/promises';

export class TauManager {
    #watchers = new Map<string, any>();
    #onReload: (() => void)[] = [];

    async start(): Promise<void> {}

    async watch(path: string): Promise<void> {
        const initialStat = await stat(path);
        let lastMtime = initialStat.mtimeMs;
        
        const interval = setInterval(async () => {
            try {
                const statData = await stat(path);
                if (statData.mtimeMs > lastMtime) {
                    lastMtime = statData.mtimeMs;
                    for (const cb of this.#onReload) cb();
                }
            } catch {}
        }, 100);
        this.#watchers.set(path, interval);
    }

    onReload(cb: () => void): void {
        this.#onReload.push(cb);
    }

    async stop(): Promise<void> {
        for (const watcher of this.#watchers.values()) {
            clearInterval(watcher);
        }
        this.#watchers.clear();
        this.#onReload = [];
    }
}
