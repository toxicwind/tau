import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getRecentSessions } from "tau/session/session-listing";
import { SessionManager } from "tau/session/session-manager";
import { resetSessionIndexForTests } from "tau/session/session-index";
import { getConfigRootDir, removeSyncWithRetries, setAgentDir } from "@tau/tau-utils";
