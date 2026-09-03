import { expect, test, describe } from 'bun:test';
import { SessionStore, CURRENT_STATE_VERSION } from '../src/session/SessionStore';
import type { SessionManager } from '../src/session/session-manager';
import type { FileEntry } from '../src/session/session-entries';
import { write } from 'bun';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SessionStore', () => {
    const testDir = join(tmpdir(), 'tau-session-store-test');
    const snapshotPath = join(testDir, 'session.json');

    const mockSessionManager = {
        getEntries: () => [{ id: '1', content: 'test', type: 'file' } as FileEntry],
        getBlobStore: () => ({}),
        getSessionDir: () => testDir
    } satisfies SessionManager;

    test('should save and load state', async () => {
        await SessionStore.save(mockSessionManager, snapshotPath);
        const state = await SessionStore.load(snapshotPath);
        
        expect(state).not.toBeNull();
        expect(state?.version).toBe(CURRENT_STATE_VERSION);
        expect(state?.data.history[0].id).toBe('1');
    });

    test('should handle schema version mismatch', async () => {
        const oldState = { version: '0.0.1', data: { history: [], context: '' }, timestamp: new Date().toISOString() };
        await write(snapshotPath, JSON.stringify(oldState));
        
        const state = await SessionStore.load(snapshotPath);
        expect(state?.version).toBe('0.0.1');
    });

    test('should handle non-existent file', async () => {
        const state = await SessionStore.load(join(testDir, 'nonexistent.json'));
        expect(state).toBeNull();
    });
});
