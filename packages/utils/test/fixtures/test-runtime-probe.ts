import { isBunTestRuntime } from "@tau/tau-utils/env";

process.stdout.write(JSON.stringify(isBunTestRuntime()));
