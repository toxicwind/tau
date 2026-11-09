/**
 * Permission Gate Hook
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, sudo, chmod/chown 777
 */
import type { HookAPI } from "@tau/tau-coding-agent";
