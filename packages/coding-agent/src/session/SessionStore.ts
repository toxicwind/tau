import { write } from 'bun';
import { rename } from 'node:fs/promises';
import { prepareEntryForPersistence } from './session-persistence';
import type { SessionManager } from './session-manager';
import type { SessionEntry, FileEntry } from './session-entries';

export interface SessionState {
    version: string;
    data: {
        history: FileEntry[];
        context: string;
    };
    timestamp: string;
}

export const CURRENT_STATE_VERSION = "1.0.0";

export class SessionStore {
    static async save(sessionManager: SessionManager, snapshotPath: string) {
        // Collect state components
        // Prepare entries using the existing persistence logic
        const rawEntries = sessionManager.getEntries();
        const blobStore = sessionManager.getBlobStore();
        
        const persistentEntries = rawEntries.map(entry => prepareEntryForPersistence(entry, blobStore));

        const stateData = {
            history: persistentEntries,
            context: sessionManager.getSessionDir(),
        };

        const snapshot: SessionState = {
            version: CURRENT_STATE_VERSION,
            data: stateData,
            timestamp: new Date().toISOString()
        };

        // Atomic write using a temporary file
        const tmpPath = `${snapshotPath}.tmp`;
        const writer = Bun.file(tmpPath).writer();
        writer.write(JSON.stringify(snapshot));
        writer.end();
        
        // Atomic rename (POSIX)
        try {
            await rename(tmpPath, snapshotPath);
        } catch (e) {
            console.error("Failed to atomic rename snapshot:", e);
        }
    }

    static async load(snapshotPath: string): Promise<SessionState | null> {
        try {
            const file = Bun.file(snapshotPath);
            if (!(await file.exists())) return null;
            
            const raw = await file.json() as unknown;
            
            // Basic validation
            if (!raw || typeof raw !== 'object' || !('version' in raw)) return null;
            
            const state = raw as SessionState;
            
            if (state.version !== CURRENT_STATE_VERSION) {
                console.warn(`State version mismatch: ${state.version} vs ${CURRENT_STATE_VERSION}`);
            }
            
            return state;
        } catch (e) {
            console.error("Failed to load session state, partial recovery required:", e);
            return null;
        }
    }
}
