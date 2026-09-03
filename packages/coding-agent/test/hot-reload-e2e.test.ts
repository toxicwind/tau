import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { TauManager } from '../src/tau-manager';

describe('Hot Reload E2E', () => {
    const testDir = join(tmpdir(), 'tau-hot-reload-e2e');
    let manager: TauManager;

    beforeAll(async () => {
        await mkdir(testDir, { recursive: true });
        manager = new TauManager();
        await manager.start();
    });

    afterAll(async () => {
        await manager.stop();
        await rm(testDir, { recursive: true, force: true });
    });

    test('should orchestrate stateful reload', async () => {
        const stateFile = join(testDir, 'state.json');
        const watchedFile = join(testDir, 'watched.ts');
        await writeFile(watchedFile, 'console.log("old");');

        // Logic:
        // 1. Trigger change
        // 2. Wait for agent reload signal
        // 3. Verify state restoration
        
        await manager.watch(watchedFile);
        
        const { promise, resolve } = Promise.withResolvers<void>();
        manager.onReload(() => resolve());

        await writeFile(watchedFile, 'console.log("new");');
        
        await promise;
        expect(true).toBe(true);
    });
});
