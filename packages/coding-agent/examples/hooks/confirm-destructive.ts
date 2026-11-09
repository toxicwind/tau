/**
 * Confirm Destructive Actions Hook
 *
 * Prompts for confirmation before destructive session actions (clear, switch, branch).
 * Demonstrates how to cancel session events using the before_* events.
 */
import type { HookAPI, SessionBeforeSwitchEvent, SessionMessageEntry } from "@tau/tau-coding-agent";
