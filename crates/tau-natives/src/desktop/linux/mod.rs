pub mod ax;
pub mod wayland;
pub mod x11;

use super::{
	backend::Backend,
	error::{CoreResult, DesktopError},
	types::DisplaySelector,
};

pub fn new_backend(display: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
	ensure_session_display_env();
	if std::env::var_os("WAYLAND_DISPLAY").is_some() {
		return Ok(Box::new(wayland::WaylandBackend::new(display)));
	}
	if std::env::var_os("DISPLAY").is_some() {
		return Ok(Box::new(x11::X11Backend::new(display)?));
	}
	Err(DesktopError::capture_failed(
		"no display server (neither WAYLAND_DISPLAY nor DISPLAY is set)",
	))
}

/// Populate display/session environment from the live user session when the
/// process was started without it (SSH, systemd user services, `sudo`, bare
/// tmux panes). The display vars are session routing coordinates — the same
/// values a login shell on the local seat would export — so re-discovering
/// them here is equivalent to inheriting them, and it keeps every child the
/// process spawns (grim, hyprctl, wl-copy, X clients) working too.
///
/// Discovery reads the XDG runtime dir (`XDG_RUNTIME_DIR` is set by pam/
/// systemd even over SSH) plus the X11 socket dir; nothing is mutated when a
/// real display env is already present, and no error is ever raised — the
/// caller keeps its original "no display server" failure when there truly is
/// no session.
fn ensure_session_display_env() {
	let have_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
	let have_x11 = std::env::var_os("DISPLAY").is_some();
	if have_wayland && have_x11 {
		return;
	}

	let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR")
		.map(std::path::PathBuf::from)
		.or_else(|| {
			// pam normally sets XDG_RUNTIME_DIR; fall back to the conventional
			// per-uid directory when it is absent.
			let uid = unsafe { libc::getuid() };
			let dir = std::path::PathBuf::from(format!("/run/user/{uid}"));
			dir.is_dir().then_some(dir)
		});

	if !have_wayland {
		if let Some(dir) = runtime_dir.as_deref() {
			if let Some(name) = first_socket_name(dir, "wayland-") {
				set_env("WAYLAND_DISPLAY", &name);
				if std::env::var_os("XDG_SESSION_TYPE").is_none() {
					set_env("XDG_SESSION_TYPE", "wayland");
				}
				// Hyprland IPC: the signature is the instance directory name
				// under $XDG_RUNTIME_DIR/hypr/<signature>/.
				if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_none() {
					if let Some(sig) = first_dir_name(&dir.join("hypr")) {
						set_env("HYPRLAND_INSTANCE_SIGNATURE", &sig);
					}
				}
			}
		}
	}

	if !have_x11 {
		if let Some(name) = first_socket_name(std::path::Path::new("/tmp/.X11-unix"), "X") {
			// Socket files are named `X0`, `X1`; DISPLAY is `:0`, `:1`.
			set_env("DISPLAY", &format!(":{}", name.trim_start_matches('X')));
			if std::env::var_os("XDG_SESSION_TYPE").is_none() {
				set_env("XDG_SESSION_TYPE", "x11");
			}
		}
	}
}

/// Name of the first `prefix*` unix socket inside `dir` (sorted, so the
/// result is deterministic across the wayland-0/wayland-1 pair).
fn first_socket_name(dir: &std::path::Path, prefix: &str) -> Option<String> {
	use std::os::unix::fs::FileTypeExt as _;
	let entries = std::fs::read_dir(dir).ok()?;
	let mut names: Vec<String> = entries
		.flatten()
		.filter_map(|entry| {
			let name = entry.file_name().to_string_lossy().into_owned();
			let is_socket = entry
				.file_type()
				.ok()
				.map(|kind| kind.is_socket())
				.unwrap_or(false);
			(is_socket && name.starts_with(prefix)).then_some(name)
		})
		.collect();
	names.sort();
	names.into_iter().next()
}

/// Name of the first subdirectory of `dir` (sorted) — used to recover the
/// Hyprland instance signature from `$XDG_RUNTIME_DIR/hypr/<signature>`.
fn first_dir_name(dir: &std::path::Path) -> Option<String> {
	let entries = std::fs::read_dir(dir).ok()?;
	let mut names: Vec<String> = entries
		.flatten()
		.filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
		.map(|entry| entry.file_name().to_string_lossy().into_owned())
		.collect();
	names.sort();
	names.into_iter().next()
}

fn set_env(key: &str, value: &str) {
	// SAFETY: called on the tool-dispatch path before the desktop backend is
	// constructed; only writes the caller's own session coordinates.
	unsafe { std::env::set_var(key, value) };
}
