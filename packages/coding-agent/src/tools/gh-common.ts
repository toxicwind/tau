import { join } from "node:path";
import * as path from "node:path";
import type { AgentToolResult } from "@tau/tau-agent-core";
import * as vcs from "@tau/tau-natives/vcs";
import { untilAborted } from "@tau/tau-utils";
