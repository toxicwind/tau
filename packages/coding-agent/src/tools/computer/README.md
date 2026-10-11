# Computer Tool and Eval Prelude

The `computer` tool controls the desktop across operating systems.
On Linux, it supports Wayland and Hyprland.

## Layout

```
packages/coding-agent/src/tools/computer/
├── README.md               # Head documentation
├── hyprland.ts             # Hyprland IPC controller
├── worker.ts               # Desktop worker runtime
├── supervisor.ts           # Worker supervisor
├── protocol.ts             # Message types
├── call.ts                 # Call chain validator
├── prelude-definition.ts   # Prelude asset loader
├── prelude.js              # JavaScript facade
├── prelude.py              # Python facade
└── declarations.d.ts       # Type declarations
```

## Hyprland Architecture

Standard accessibility tools often miss windows on Wayland.
Our fork adds direct Hyprland support.

### Hyprland IPC

The controller connects to the UNIX domain socket.
It reads windows using `j/clients`.
It reads monitors using `j/monitors`.

### Window Activation

The controller focuses windows with the dispatcher.
It executes `hl.dsp.window.focusaddr`.
This action bypasses Wayland focus limits.

### Capture

PipeWire captures full screens.
`grim` captures window regions.

### Fallback

The runtime checks native sessions first.
It uses Hyprland IPC when native lists are empty.
All test suites pass.
