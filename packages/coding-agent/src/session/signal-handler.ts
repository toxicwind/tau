import type { SessionManager } from './session-manager';
import { SessionStore } from './SessionStore';

let activeSessionManager: SessionManager | undefined;

export function registerSessionManager(manager: SessionManager) {
    activeSessionManager = manager;
}

export function setupSignalHandler(snapshotPath: string) {
    process.on('SIGUSR1', async () => {
        if (activeSessionManager) {
            console.log("SIGUSR1 received. Saving session state...");
            await SessionStore.save(activeSessionManager, snapshotPath);
            console.log("Session state saved. Exiting.");
            process.exit(0);
        } else {
            console.warn("SIGUSR1 received but no session manager registered.");
        }
    });
}
