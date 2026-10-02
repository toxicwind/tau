import { __isExtensionParseCacheAvailableForTests } from "../../src/extensibility/plugins/legacy-tau-compat";

process.stdout.write(__isExtensionParseCacheAvailableForTests() ? "AVAILABLE\n" : "UNAVAILABLE\n");
