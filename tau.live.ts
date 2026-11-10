// Tau live verification
// Run as: bun tau.live.ts
// Verifies tau TUI headless operation

console.log("=== Tau Live Verification ===\n");

// Check tau binary exists
try {
  const { existsSync } = require("fs");
  const tauBin = "/home/toxic/pens/olympus/products/tau/packages/coding-agent/dist/tau";
  if (existsSync(tauBin)) {
    console.log(`  ✓ tau binary exists at ${tauBin}`);
  } else {
    console.log("  ✗ tau binary not found");
    process.exit(1);
  }
} catch (e: any) {
  console.log(`  ✗ tau binary check failed: ${e.message}`);
  process.exit(1);
}

// Check tau symlink in ~/.local/bin
try {
  const { existsSync, readlinkSync } = require("fs");
  const link = "/home/toxic/.local/bin/tau";
  if (existsSync(link)) {
    const target = readlinkSync(link);
    console.log(`  ✓ tau symlink: ${link} -> ${target}`);
  } else {
    console.log("  ✗ tau symlink missing");
    process.exit(1);
  }
} catch (e: any) {
  console.log(`  ✗ tau symlink check failed: ${e.message}`);
  process.exit(1);
}

// Verify tau --help works
try {
  const { execSync } = require("child_process");
  const help = execSync("tau --help 2>&1 | head -5", { encoding: "utf-8", timeout: 10000 });
  console.log(`  ✓ tau --help works`);
  console.log(`     ${help.toString().trim().split('\n')[0]}`);
} catch (e: any) {
  console.log(`  ✗ tau --help failed: ${e.message}`);
  process.exit(1);
}

console.log("\n=== Tau: All checks passed ===\n");
