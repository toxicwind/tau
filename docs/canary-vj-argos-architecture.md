# Canary AST, Argos Shimming & MiniMeters VJ Engine — Full-Grade Architecture

**Status:** Active Execution  
**Target:** Bun 1.4.4 Canary / OMP Upstream Parity / Tablet VJ Deployment  
**SSOT Location:** `pens/olympus/products/tau/docs/canary-vj-argos-architecture.md`  

---

## 1. Executive Doctrine: Ground Truth & Non-Monkeypatch Engineering

This architecture enforces the Absolute Truth Hierarchy across our sovereign federated pens:
1. **Live System State & Verified Code > Markdown Prose.** (No rollbacks based on outdated documentation notes).
2. **Upstream Pattern Borrowing over Ad-Hoc Monkeypatching.** Clean adherence to the `can1357/oh-my-pi` (OMP) architecture, adapting `@tau/*` contracts rather than pasting conflicting inline code blocks.
3. **Telemetry-over-Pixels VJ Pipeline.** Decoupling audio DSP calculation (host side) from rendering (tablet side) to deliver 60–120 FPS at ~9ms LAN latency.

---

## 2. Lane 1: MiniMeters & VJ Engine (Tablet Hot-Reload on Bun 1.4.4)

### A. Architectural Hoisting
MiniMeters (clinical accuracy) and NestDrop (visceral audio-reactivity) are hoisted into a unified **Acoustic Topology**:
- **Gravitational Spine:** Low-end (<120Hz) phase coherence represented as a dense, centered vertical column. Phase cancellation causes the column to fissure and bloom into translucent fog.
- **Thermal Surface (ERB/Bark Scale):** Blackbody radiation across a 3D elevation grid. Resonances (2.5k–4.5kHz glare) render as high-specular heat flares; 300Hz mud renders as stagnant visual silt.
- **Kinetic Tension:** Dynamic range / crest factor mapped to liquid surface tension. Compressed sausage masters freeze the surface; healthy transients puncture the skin.
- **3-Band Traktor/Serato Spectral Coloring (Borrowed from `nanometers`):**
  - Bass (<250Hz): Red
  - Mids (250Hz–2.5kHz): Green
  - Highs / Air (>2.5kHz): Blue
  - Broadband alignment: White

### B. High-Performance WebSocket Bridge Format (LE Float32, 2208 Floats)
- **Header (32 floats):** SampleRate, LUFS-M, LUFS-S, LUFS-I, LRA, TruePeak L/R, Correlation (Total, Low, Mid, High), Peak Hz, Peak dB, f0, f0 Confidence, RMS (Low, Mid, High), Wave (Min, Max, RMS), SamplePeak L/R.
- **Mel Spectrum:** 512 floats (FFT 8192, 20Hz–20kHz).
- **Oscilloscope:** 512 floats (normalized waveform window).
- **Stereometer (Lissajous):** 1152 floats (3 frequency bands × 192 stereo coordinate pairs).

---

## 3. Lane 2: Canary AST & Clean Argos Shimming in Tau Builtins

### A. `jfind` (`packages/coding-agent/src/tools/jfind/index.ts`)
- Restored clean `runCascade` exploration over `InternalUrlFilesystem` from upstream OMP.
- **Argos Non-Judged Fast Path:** When no System One native judge model is armed (`!canJudge`), non-judged semantic queries route directly to the local Argos index plane (`http://127.0.0.1:25254/_search`) with reciprocal rank scoring, bypassing unnecessary LLM allocations and eliminating fork stalls.

### B. `grep` (`packages/coding-agent/src/tools/grep.ts`)
- Stripped conflicting merge blocks (`Identifier grep has already been declared`, duplicate `totalCapReached`, `perFileLimitReached`).
- Native streaming pagination preserved (`skip`, `perFileMatchCap = 20`, `SINGLE_FILE_MATCHES = 200`).
- Fully passes `oxlint` and `tsc --noEmit`.

---

## 4. Lane 3: System Stability & Daemon Recovery

- **`systemd-oomd` Defanged:** Masked via `systemctl mask --now systemd-oomd` to permanently ban kernel PSI kills against active developer SSH sessions.
- **Swap Thrashing Extinguished:** 15GB dirty swap flushed back to physical RAM via `swapoff -a && swapon -a`. Available RAM: >40 GB.
- **RustDesk Loop Eliminated:** `rustdesk-host.service` stopped and hundreds of leaked `/tmp/.mount_rustde*` FUSE mounts unmounted.
- **Pitchfork SSOT Cleaned:** 89 legacy `estate/*` ghost daemons scrubbed from `state.toml`. Pitchfork supervisor runs lean without process storms.
