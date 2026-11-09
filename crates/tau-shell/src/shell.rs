//! The embedded shell: pi's commands run on a [`crate::bash`] engine session
//! ([`crate::session::Session`]) over pi's filesystem, with pi's
//! utilities, process builtins and `git` layers as engine commands.

#[cfg(windows)]
use std::collections::HashSet;
use std::{
	collections::HashMap,
	fs,
	io::{self},
	path::Path,
	sync::{
		Arc,
		atomic::{AtomicBool, Ordering},
	},
	time::Duration,
};

use anyhow::{Error, Result};
use bstr::{BString, ByteSlice};
use bytes::Bytes;
use flume::Sender;
<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `use pi_builtins::{BuiltinSet, default_builtins};`
use tau_builtins::{BuiltinSet, default_builtins};
=======
use pi_vfs::Fs;
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain crates/tau-shell/src/shell.rs' for per-hunk detail, 'weave check' to verify your resolution
#[cfg(not(unix))]
use tokio::io::AsyncReadExt as _;
use tokio::{sync::Mutex as TokioMutex, time};
use tokio_util::sync::CancellationToken;

pub use crate::git::GIT_REPO_LOCATION_ENV_VARS;
use crate::{
	bash::trace::{RunTrace, SegmentSource},
	cancel::{AbortReason, AbortToken, CancelToken},
	git::is_git_repo_location_var,
	minimizer,
	output_decode::CaptureDecoder,
	session::{
		Children, Image, LatestImage, RunOptions, RunOutcome, RunStdio, Session, SessionConfig,
		SessionError,
	},
	taps::PipeTaps,
	vfs::VfsFs,
};

/// A live engine session and the filesystem it runs on.
struct ShellSessionCore {
	session:    Session,
	/// The engine's filesystem slot (shared with the session's host). Each run
	/// installs a cancellation-scoped view of the session filesystem, or of
	/// the run's own override, and restores the session filesystem after it.
	slot:       VfsFs,
	/// Session filesystem.
	filesystem: Fs,
	/// The shell's working directory after the last command.
	cwd:        BString,
}

#[derive(Clone, Default)]
struct ShellAbortState(Arc<TokioMutex<Option<AbortToken>>>);

impl ShellAbortState {
	async fn set(&self, abort_token: AbortToken) {
		*self.0.lock().await = Some(abort_token);
	}

	async fn clear(&self) {
		*self.0.lock().await = None;
	}

	async fn abort(&self) {
		let abort_token = self.0.lock().await.clone();
		if let Some(abort_token) = abort_token {
			abort_token.abort(AbortReason::Signal);
		}
	}
}

/// `path` as the engine spells it.
fn path_bytes(path: &Path) -> BString {
	BString::from(path.as_os_str().as_encoded_bytes())
}

/// Whether the shell, now in `current`, is already in `requested`.
fn working_dir_matches(current: &[u8], requested: &str) -> bool {
	let path = Path::new(requested);
	if pi_vfs::is_virtual_path(path) {
		return current == requested.as_bytes();
	}
	if !path.is_absolute() {
		return false;
	}
	// The stored dir is long-form on Windows (every `cd` stores what the
	// request expanded to), so only the requested spelling needs expansion
	// for a short-spelled host cwd to match its long spelling.
	#[cfg(windows)]
	{
		current == path_bytes(&crate::windows::expand_to_long_path(path)).as_slice()
	}
	#[cfg(not(windows))]
	{
		current == requested.as_bytes()
	}
}

/// The directory to move the shell to before a command: `None` when it is
/// there already. Like `cd`, the target must be a directory the run's
/// filesystem knows; a short-spelled Windows path is stored long-form, a URL
/// path verbatim.
async fn requested_cwd(core: &ShellSessionCore, cwd: Option<&str>) -> Result<Option<BString>> {
	let Some(cwd) = cwd else {
		return Ok(None);
	};
	if working_dir_matches(&core.cwd, cwd) {
		return Ok(None);
	}
	let path = Path::new(cwd);
	let target = if pi_vfs::is_virtual_path(path) {
		path.to_path_buf()
	} else if path.is_absolute() {
		#[cfg(windows)]
		{
			crate::windows::expand_to_long_path(path)
		}
		#[cfg(not(windows))]
		{
			path.to_path_buf()
		}
	} else {
		return Err(Error::msg(format!("Failed to set cwd: {cwd} is not an absolute path")));
	};
	match core.slot.filesystem().metadata(&target).await {
		Ok(metadata) if metadata.file_type().is_dir() => Ok(Some(path_bytes(&target))),
		Ok(_) => Err(Error::msg(format!("Failed to set cwd: {cwd}: Not a directory"))),
		Err(err) => Err(Error::msg(format!("Failed to set cwd: {cwd}: {err}"))),
	}
}

#[derive(Clone)]
struct ShellConfig {
	session_env:   Option<HashMap<String, String>>,
	snapshot_path: Option<String>,
	minimizer:     Option<minimizer::MinimizerConfig>,
	filesystem:    Fs,
	/// The state a forked shell's session starts from ([`Shell::fork`]);
	/// it replaces the env fallback and snapshot sourcing of a new session.
	seed:          Option<Image>,
}

#[derive(Debug, Clone, Default)]
pub struct ShellOptions {
	pub session_env:   Option<HashMap<String, String>>,
	pub snapshot_path: Option<String>,
	pub minimizer:     Option<minimizer::MinimizerOptions>,
	/// Filesystem backing every run of the session (native by default).
	pub filesystem:    Fs,
}

struct ShellRunConfig {
	command:    String,
	cwd:        Option<String>,
	env:        Option<HashMap<String, String>>,
	minimizer:  Option<minimizer::MinimizerConfig>,
	/// Replaces the session filesystem for this run only.
	filesystem: Option<Fs>,
	/// Mirrors the run's pipeline pipes.
	pipe_taps:  Option<Arc<PipeTaps>>,
	/// Folds the run's engine events.
	trace:      Option<Arc<RunTrace>>,
}

#[derive(Debug, Clone, Default)]
pub struct ShellRunOptions {
	pub command:    String,
	pub cwd:        Option<String>,
	pub env:        Option<HashMap<String, String>>,
	pub timeout_ms: Option<u32>,
	/// Filesystem for this run only; the session filesystem when `None`.
	pub filesystem: Option<Fs>,
	/// Receives a copy of every byte crossing the run's pipeline pipes.
	pub pipe_taps:  Option<Arc<PipeTaps>>,
	/// Folds the run's engine events into a live model of `command`
	/// (built over the same command text).
	pub trace:      Option<Arc<RunTrace>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MinimizerResult {
	pub filter:        String,
	pub text:          String,
	pub original_text: String,
	pub input_bytes:   u32,
	pub output_bytes:  u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShellRunResult {
	pub exit_code:   Option<i32>,
	pub cancelled:   bool,
	pub timed_out:   bool,
	pub minimized:   Option<MinimizerResult>,
	pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ShellExecuteOptions {
	pub command:       String,
	pub cwd:           Option<String>,
	pub env:           Option<HashMap<String, String>>,
	pub session_env:   Option<HashMap<String, String>>,
	pub timeout_ms:    Option<u32>,
	pub snapshot_path: Option<String>,
	pub minimizer:     Option<minimizer::MinimizerOptions>,
	/// Filesystem backing the command (native by default).
	pub filesystem:    Fs,
}

pub type ShellExecuteResult = ShellRunResult;

/// Handles of the live session readable apart from the session mutex (held
/// for the whole command), so [`Shell::pids`] and [`Shell::fork`] never wait
/// for it. Set when a session is created, cleared when it is dropped.
type ActiveSession = Arc<parking_lot::Mutex<Option<SessionHandles>>>;

struct SessionHandles {
	/// The live externals of the session's run in flight.
	children: Children,
	/// The session's state at its last command boundary.
	image:    LatestImage,
}

impl SessionHandles {
	fn of(session: &Session) -> Self {
		Self { children: session.children(), image: session.latest_image() }
	}
}

pub struct Shell {
	session:     Arc<TokioMutex<Option<ShellSessionCore>>>,
	abort_state: ShellAbortState,
	config:      ShellConfig,
	active:      ActiveSession,
}

impl Shell {
	#[must_use]
	pub fn new(options: Option<ShellOptions>) -> Self {
		let config = match options {
			None => ShellConfig {
				session_env:   None,
				snapshot_path: None,
				minimizer:     None,
				filesystem:    Fs::native(),
				seed:          None,
			},
			Some(opt) => {
				let minimizer = opt
					.minimizer
					.as_ref()
					.map(minimizer::MinimizerConfig::from_options);
				ShellConfig {
					session_env: opt.session_env,
					snapshot_path: opt.snapshot_path,
					minimizer,
					filesystem: opt.filesystem,
					seed: None,
				}
			},
		};
		Self::with_config(config)
	}

	fn with_config(config: ShellConfig) -> Self {
		Self {
			session: Arc::new(TokioMutex::new(None)),
			abort_state: ShellAbortState::default(),
			config,
			active: ActiveSession::default(),
		}
	}

	/// A new shell with this one's options whose session starts from this
	/// session's state (variables, functions, aliases, options, working
	/// directory) as of its last command boundary: while a command runs, the
	/// state that command started from. What the fork sets stays in the
	/// fork. Never waits for a running command. Before this shell has a
	/// session, the fork starts from this shell's own seed, or as a new
	/// shell.
	#[must_use]
	pub fn fork(&self) -> Self {
		let latest = self.active.lock().as_ref().map(|active| active.image.get());
		Self::with_config(ShellConfig {
			seed: latest.or_else(|| self.config.seed.clone()),
			..self.config.clone()
		})
	}

	pub async fn run(
		&self,
		options: ShellRunOptions,
		on_chunk: Option<Sender<String>>,
		mut cancel_token: CancelToken,
	) -> Result<ShellRunResult> {
		let run_config = ShellRunConfig {
			command:    options.command,
			cwd:        options.cwd,
			env:        options.env,
			minimizer:  self.config.minimizer.clone(),
			filesystem: options.filesystem,
			pipe_taps:  options.pipe_taps,
			trace:      options.trace,
		};
		run_shell_session(
			self.session.clone(),
			self.abort_state.clone(),
			self.active.clone(),
			self.config.clone(),
			run_config,
			on_chunk,
			&mut cancel_token,
		)
		.await
	}

	pub async fn abort(&self) {
		self.abort_state.abort().await;
	}

	/// Pids of the processes spawned by the in-flight [`Shell::run`] that are
	/// still alive, in spawn order. Covers every external child the session
	/// started — foreground commands, pipeline stages, and `&` background
	/// jobs — but not builtins, which run in-process. Empty when no run is
	/// executing (including one still waiting for a previous run to release
	/// the session). Never blocks on the session lock held by a running
	/// command.
	#[must_use]
	pub fn pids(&self) -> Vec<i32> {
		self
			.active
			.lock()
			.as_ref()
			.map_or_else(Vec::new, |active| active.children.pids())
	}

	/// Number of live external background jobs tracked by the persistent
	/// session. The host retains a per-call shell while this is nonzero, since
	/// dropping it would kill its children. Exited children are reaped
	/// without discarding their status, so a later `wait` still sees the exit
	/// code. 0 when the session is gone.
	pub async fn live_background_job_count(&self) -> u32 {
		let guard = self.session.lock().await;
		let Some(core) = guard.as_ref() else {
			return 0;
		};
		core
			.session
			.live_external_jobs()
			.await
			.map_or(0, |count| u32::try_from(count).unwrap_or(u32::MAX))
	}
}

pub async fn execute_shell(
	options: ShellExecuteOptions,
	on_chunk: Option<Sender<String>>,
	cancel_token: CancelToken,
) -> Result<ShellExecuteResult> {
	let minimizer = options
		.minimizer
		.as_ref()
		.map(minimizer::MinimizerConfig::from_options);
	let config = ShellConfig {
		session_env:   options.session_env,
		snapshot_path: options.snapshot_path,
		minimizer:     minimizer.clone(),
		filesystem:    options.filesystem,
		seed:          None,
	};
	let run_config = ShellRunConfig {
		command: options.command,
		cwd: options.cwd,
		env: options.env,
		minimizer,
		filesystem: None,
		pipe_taps: None,
		trace: None,
	};
	run_shell_oneshot(config, run_config, on_chunk, cancel_token).await
}

/// Optional per-stream raw byte sinks for [`execute_shell_streams`].
///
/// When a sink is `Some`, that stream's pipe is drained directly into the
/// channel with no UTF-8 decoding and no merging. When `None`, the
/// corresponding pipe is still drained (to avoid blocking the child) but
/// its bytes are dropped.
#[derive(Default)]
pub struct StreamSinks {
	pub stdout: Option<Sender<Bytes>>,
	pub stderr: Option<Sender<Bytes>>,
}

/// One-shot execution that delivers stdout/stderr as raw byte chunks.
///
/// Bytes are delivered on separate channels with no UTF-8 decoding and no
/// merging. The minimizer is intentionally disabled — its
/// `MinimizerResult.text` contract presumes a single merged transcript.
pub async fn execute_shell_streams(
	options: ShellExecuteOptions,
	streams: StreamSinks,
	cancel_token: CancelToken,
) -> Result<ShellExecuteResult> {
	let config = ShellConfig {
		session_env:   options.session_env,
		snapshot_path: options.snapshot_path,
		minimizer:     None,
		filesystem:    options.filesystem,
		seed:          None,
	};
	let run_config = ShellRunConfig {
		command:    options.command,
		cwd:        options.cwd,
		env:        options.env,
		minimizer:  None,
		filesystem: None,
		pipe_taps:  None,
		trace:      None,
	};
	run_shell_oneshot_streams(config, run_config, streams, cancel_token).await
}

/// How long a cancelled run waits for its task to wind down before aborting
/// it (discarding any output still queued in the pipe readers, and stopping
/// the command with `KILL`).
///
/// The session's own cancel sends `TERM`, then `KILL` after its 1 s grace;
/// a run that ends within these two seconds reports normally. Windows needs a
/// wider budget: in-process pipeline producers stop on a poll between
/// writes, so producer exit, pipe EOF, the consumer's final flush and the
/// reader's last read each need a separate thread wakeup; under heavy load
/// that chain exceeded 2s (`yes x | tail -5` lost its 5 lines).
#[cfg(windows)]
const CANCEL_RUN_GRACE: Duration = Duration::from_secs(5);
#[cfg(not(windows))]
const CANCEL_RUN_GRACE: Duration = Duration::from_secs(2);

/// Delay between cancellation and cancelling the output readers. Readers stay
/// open so pipeline consumers can flush after their producers die, and so a
/// TERM trap that writes output during the session's TERM grace does not hit
/// EPIPE and die before finishing its cleanup. Windows needs a wider budget
/// for the same reason as `CANCEL_RUN_GRACE`. The delayed fallback still
/// releases readers whose writers never close.
#[cfg(windows)]
const CANCEL_READER_GRACE: Duration = Duration::from_millis(2000);
#[cfg(not(windows))]
const CANCEL_READER_GRACE: Duration = Duration::from_millis(1250);

/// What a run reports when it ends normally.
struct CommandResult {
	status:      i32,
	minimized:   Option<MinimizerResult>,
	working_dir: String,
}

impl CommandResult {
	fn into_run_result(self) -> ShellRunResult {
		ShellRunResult {
			exit_code:   Some(self.status),
			cancelled:   false,
			timed_out:   false,
			minimized:   self.minimized,
			working_dir: Some(self.working_dir),
		}
	}
}

/// The result of a run cancelled by `reason`.
const fn cancelled_result(reason: AbortReason) -> ShellRunResult {
	ShellRunResult {
		exit_code:   None,
		cancelled:   matches!(reason, AbortReason::Signal),
		timed_out:   matches!(reason, AbortReason::Timeout),
		minimized:   None,
		working_dir: None,
	}
}

async fn run_shell_session(
	session: Arc<TokioMutex<Option<ShellSessionCore>>>,
	abort_state: ShellAbortState,
	active: ActiveSession,
	config: ShellConfig,
	run_config: ShellRunConfig,
	on_chunk: Option<Sender<String>>,
	ct: &mut CancelToken,
) -> Result<ShellRunResult> {
	let tokio_cancel = CancellationToken::new();
	let mut run_task = tokio::spawn({
		let session = session.clone();
		let abort_state = abort_state.clone();
		let active = active.clone();
		let tokio_cancel = tokio_cancel.clone();
		let at = ct.emplace_abort_token();
		async move {
			let mut session_guard = session.lock().await;
			let core = if let Some(core) = &mut *session_guard {
				core
			} else {
				let core = create_session_for_run(&config, Some(&tokio_cancel)).await?;
				*active.lock() = Some(SessionHandles::of(&core.session));
				session_guard.insert(core)
			};
			abort_state.set(at).await;
			run_shell_command(core, &run_config, on_chunk, tokio_cancel).await
		}
	});

	let res = tokio::select! {
		res = &mut run_task => res,
		reason = ct.wait() => {
			tokio_cancel.cancel();
			let graceful = time::timeout(CANCEL_RUN_GRACE, &mut run_task).await;
			if graceful.is_err() {
				// Dropping the run stops the command with `KILL`.
				run_task.abort();
				let _ = run_task.await;
			}
			abort_state.clear().await;
			// Use try_lock to avoid deadlocking if another task holds the session.
			// If we can't acquire the lock, the session will be cleaned up when the
			// holding task finishes.
			if let Ok(mut guard) = session.try_lock() {
				*guard = None;
				*active.lock() = None;
			}
			return Ok(cancelled_result(reason));
		}
	};
	let res =
		res.unwrap_or_else(|err| Err(Error::msg(format!("Shell execution task failed: {err}"))));
	abort_state.clear().await;

	// `exit`, errexit, or a stray top-level `return`/`break` ends this command,
	// not the session: the next run keeps the variables, functions, and options
	// built so far. Only a failed run leaves the shell in an unknown state.
	if res.is_err() {
		*session.lock().await = None;
		*active.lock() = None;
	}
	Ok(res?.into_run_result())
}

async fn run_shell_oneshot(
	config: ShellConfig,
	run_config: ShellRunConfig,
	on_chunk: Option<Sender<String>>,
	ct: CancelToken,
) -> Result<ShellExecuteResult> {
	let tokio_cancel = CancellationToken::new();
	let mut task = tokio::spawn({
		let tokio_cancel = tokio_cancel.clone();
		async move {
			// The session ends with this task: its background jobs end with it.
			let mut session = create_session_for_run(&config, Some(&tokio_cancel)).await?;
			run_shell_command(&mut session, &run_config, on_chunk, tokio_cancel).await
		}
	});

	let run_result = tokio::select! {
		result = &mut task => result,
		reason = ct.wait() => {
			tokio_cancel.cancel();
			let graceful = time::timeout(CANCEL_RUN_GRACE, &mut task).await;
			if graceful.is_err() {
				task.abort();
				let _ = task.await;
			}
			return Ok(cancelled_result(reason));
		},
	};

	let res = run_result
		.unwrap_or_else(|err| Err(Error::msg(format!("Shell execution task failed: {err}"))));
	Ok(res?.into_run_result())
}

async fn run_shell_oneshot_streams(
	config: ShellConfig,
	run_config: ShellRunConfig,
	streams: StreamSinks,
	ct: CancelToken,
) -> Result<ShellExecuteResult> {
	let tokio_cancel = CancellationToken::new();
	let mut task = tokio::spawn({
		let tokio_cancel = tokio_cancel.clone();
		async move {
			let mut session = create_session_for_run(&config, Some(&tokio_cancel)).await?;
			run_shell_command_streams(&mut session, &run_config, streams, tokio_cancel).await
		}
	});

	let run_result = tokio::select! {
		result = &mut task => result,
		reason = ct.wait() => {
			tokio_cancel.cancel();
			let graceful = time::timeout(CANCEL_RUN_GRACE, &mut task).await;
			if graceful.is_err() {
				task.abort();
				let _ = task.await;
			}
			return Ok(cancelled_result(reason));
		},
	};

	let res = run_result
		.unwrap_or_else(|err| Err(Error::msg(format!("Shell execution task failed: {err}"))));
	Ok(res?.into_run_result())
}

/// The null device, for a stream a command must not see.
fn null_file() -> Result<fs::File> {
	let path = if cfg!(windows) { "NUL" } else { "/dev/null" };
	fs::OpenOptions::new()
		.read(true)
		.write(true)
		.open(path)
		.map_err(|err| Error::msg(format!("Failed to create null file: {err}")))
}

/// Standard streams for a command that reads nothing and writes nowhere.
fn null_stdio() -> Result<RunStdio> {
	Ok(RunStdio {
		stdin:  Some(null_file()?),
		stdout: Some(null_file()?),
		stderr: Some(null_file()?),
	})
}

#[cfg(windows)]
const fn normalize_env_key(key: &str) -> &str {
	if key.eq_ignore_ascii_case("PATH") {
		"PATH"
	} else {
		key
	}
}

#[cfg(not(windows))]
const fn normalize_env_key(key: &str) -> &str {
	key
}

/// Canonical spelling for a key inherited from the host environment (the
/// process env or the caller-forwarded session env). Windows env names are
/// case-insensitive, so a host `Temp` must still surface as `$TEMP` in the
/// case-sensitive shell. Per-command env keeps the narrower
/// [`normalize_env_key`]: a lowercase `tmp` there is an ordinary variable.
#[cfg(windows)]
pub(crate) const fn normalize_inherited_env_key(key: &str) -> &str {
	if key.eq_ignore_ascii_case("TEMP") {
		"TEMP"
	} else if key.eq_ignore_ascii_case("TMP") {
		"TMP"
	} else if key.eq_ignore_ascii_case("TMPDIR") {
		"TMPDIR"
	} else {
		normalize_env_key(key)
	}
}

#[cfg(not(windows))]
pub(crate) const fn normalize_inherited_env_key(key: &str) -> &str {
	key
}

/// Value exported for an inherited (already normalized) env key.
///
/// A host `TEMP`/`TMP`/`TMPDIR` may carry an 8.3 profile alias
/// (`C:\Users\ADMINI~1\...`) while `cd` stores the long form in `PWD`, so
/// `cd "$TEMP"` would leave the two spellings disagreeing. Absolute temp paths
/// are expanded with the same `GetLongPathNameW` routine `cd` uses (symlinks
/// and junctions kept); anything else, or a failed expansion, passes through.
#[cfg(windows)]
pub(crate) fn inherited_env_value<'a>(key: &str, value: &'a str) -> std::borrow::Cow<'a, str> {
	let path = Path::new(value);
	if !matches!(key, "TEMP" | "TMP" | "TMPDIR") || !path.is_absolute() {
		return std::borrow::Cow::Borrowed(value);
	}
	match crate::windows::expand_to_long_path(path)
		.into_os_string()
		.into_string()
	{
		Ok(expanded) => std::borrow::Cow::Owned(expanded),
		Err(_) => std::borrow::Cow::Borrowed(value),
	}
}

#[cfg(not(windows))]
pub(crate) const fn inherited_env_value<'a>(
	_key: &str,
	value: &'a str,
) -> std::borrow::Cow<'a, str> {
	std::borrow::Cow::Borrowed(value)
}

#[cfg(windows)]
fn merge_path_values(existing: &str, incoming: &str) -> String {
	let mut merged = Vec::new();
	let mut seen = HashSet::new();
	push_unique_paths(&mut merged, &mut seen, existing);
	push_unique_paths(&mut merged, &mut seen, incoming);

	std::env::join_paths(merged.iter())
		.map_or_else(|_| merged.join(";"), |paths| paths.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn push_unique_paths(merged: &mut Vec<String>, seen: &mut HashSet<String>, value: &str) {
	for segment in std::env::split_paths(value) {
		let segment_str = segment.to_string_lossy().into_owned();
		let normalized = normalize_path_segment(&segment_str);
		if normalized.is_empty() {
			continue;
		}
		if seen.insert(normalized) {
			merged.push(segment_str);
		}
	}
}

#[cfg(windows)]
fn normalize_path_segment(segment: &str) -> String {
	let trimmed = segment.trim().trim_matches('"');
	if trimmed.is_empty() {
		return String::new();
	}

	let mut normalized = std::path::PathBuf::new();
	for component in Path::new(trimmed).components() {
		normalized.push(component.as_os_str());
	}

	normalized.to_string_lossy().to_ascii_lowercase()
}

#[cfg(not(windows))]
fn merge_path_values(_existing: &str, incoming: &str) -> String {
	incoming.to_string()
}

#[cfg(test)]
async fn create_session(config: &ShellConfig) -> Result<ShellSessionCore> {
	create_session_for_run(config, None).await
}

<<<<<<< ours — function `copy_env_into_shell` (T+F, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: none (both sides edited, nowhere the same lines)
/// Copies the host environment into `shell`, merging duplicate `PATH` values
/// and registering the merged `PATH` last.
///
/// Entries whose key or value is not valid Unicode are skipped: a corrupt
/// entry carries no usable meaning, and `std::env::vars()` — the naive way to
/// read the host environment — panics on the first one before any command can
/// run. `vars_os()` yields the raw entries without panicking, leaving the
/// skip decision here.
fn copy_env_into_shell(
	shell: &mut BrushShell,
	env: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) -> Result<()> {
	let mut merged_path: Option<String> = None;
	for (key, value) in env {
		// A key or value that cannot be decoded as Unicode is unusable; drop
		// it rather than panicking startup for a corrupt host environment.
		let (Some(key), Some(value)) = (key.to_str(), value.to_str()) else {
			continue;
		};
		let normalized_key = normalize_env_key(key);
		if should_skip_env_var(normalized_key) || is_git_repo_location_var(normalized_key) {
			continue;
		}
		if normalized_key == "PATH" {
			merged_path = Some(match merged_path {
				Some(existing) => merge_path_values(&existing, value),
				None => value.to_string(),
			});
			continue;
		}
		let mut var = ShellVariable::new(ShellValue::String(value.to_string()));
		var.export();
		shell
			.env_mut()
			.set_global(normalized_key, var)
			.map_err(|err| Error::msg(format!("Failed to set env: {err}")))?;
	}

	#[cfg(windows)]
	if merged_path.is_none()
		&& let Some(value) = std::env::var_os("Path").or_else(|| std::env::var_os("PATH"))
	{
		merged_path = Some(value.to_string_lossy().into_owned());
	}

	if let Some(path_value) = &merged_path {
		let mut var = ShellVariable::new(ShellValue::String(path_value.clone()));
		var.export();
		shell
			.env_mut()
			.set_global("PATH", var)
			.map_err(|err| Error::msg(format!("Failed to set env: {err}")))?;
	}

	Ok(())
=======
/// Copies the host environment into `vars` (the shell's starting
/// environment, every entry exported), merging duplicate `PATH` values and
/// setting the merged `PATH` last.
///
/// Entries whose key or value is not valid Unicode are skipped: a corrupt
/// entry carries no usable meaning, and `std::env::vars()` — the naive way to
/// read the host environment — panics on the first one before any command can
/// run. `vars_os()` yields the raw entries without panicking, leaving the
/// skip decision here. Shell-owned variables ([`should_skip_env_var`]) and
/// git repository-location overrides are not inherited.
fn copy_env_into(
	vars: &mut HashMap<String, String>,
	env: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) {
	let mut merged_path: Option<String> = None;
	for (key, value) in env {
		// A key or value that cannot be decoded as Unicode is unusable; drop
		// it rather than panicking startup for a corrupt host environment.
		let (Some(key), Some(value)) = (key.to_str(), value.to_str()) else {
			continue;
		};
		let normalized_key = normalize_inherited_env_key(key);
		if should_skip_env_var(normalized_key) || is_git_repo_location_var(normalized_key) {
			continue;
		}
		if normalized_key == "PATH" {
			merged_path = Some(match merged_path {
				Some(existing) => merge_path_values(&existing, value),
				None => value.to_string(),
			});
			continue;
		}
		let value = inherited_env_value(normalized_key, value);
		vars.insert(normalized_key.to_owned(), value.into_owned());
	}

	#[cfg(windows)]
	if merged_path.is_none()
		&& let Some(value) = std::env::var_os("Path").or_else(|| std::env::var_os("PATH"))
	{
		merged_path = Some(value.to_string_lossy().into_owned());
	}

	if let Some(path_value) = merged_path {
		vars.insert("PATH".to_owned(), path_value);
	}
>>>>>>> theirs — function `copy_env_into_shell` (T+F, confidence: medium)
}

/// Apply the caller's session env over the inherited one, with the same skips
/// and temp-path expansion.
fn apply_session_env(vars: &mut HashMap<String, String>, session_env: &HashMap<String, String>) {
	for (key, value) in session_env {
		let normalized_key = normalize_inherited_env_key(key);
		if should_skip_env_var(normalized_key) || is_git_repo_location_var(normalized_key) {
			continue;
		}
		// The agent forwards its whole host env here, so temp paths need the
		// same long-form expansion as the direct host copy.
		let value = inherited_env_value(normalized_key, value);
		vars.insert(normalized_key.to_owned(), value.into_owned());
	}
}

/// The shell's starting environment: the host's, then the session env.
fn session_vars(config: &ShellConfig) -> HashMap<String, String> {
	let mut vars = HashMap::new();
	copy_env_into(&mut vars, std::env::vars_os());
	if let Some(env) = config.session_env.as_ref() {
		apply_session_env(&mut vars, env);
	}
	#[cfg(windows)]
	crate::windows::configure_windows_path(&mut vars);
	vars
}

/// The directory a new shell starts in: the process's, or `HOME` (then `/`)
/// when a long-running host's working directory was deleted.
fn initial_cwd() -> BString {
	if let Ok(cwd) = std::env::current_dir()
		&& cwd.is_dir()
	{
		#[cfg(windows)]
		let cwd = crate::windows::expand_to_long_path(&cwd);
		return path_bytes(&cwd);
	}
	let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
		.map(std::path::PathBuf::from)
		.filter(|home| home.is_dir());
	home.map_or_else(|| BString::from("/"), |home| path_bytes(&home))
}

/// Start a session for `config`, from its seed when it has one. Setup (the
/// `env` fallback, snapshot sourcing) belongs to the creating run, so its
/// processes and provider calls stop with `cancel_token`.
async fn create_session_for_run(
	config: &ShellConfig,
	cancel_token: Option<&CancellationToken>,
) -> Result<ShellSessionCore> {
	let cancel = cancel_token.cloned().unwrap_or_default();
	let runtime = tokio::runtime::Handle::current();
	let slot = VfsFs::new(config.filesystem.with_cancellation(cancel.clone()), runtime.clone());
	let vars = session_vars(config);
	let has_env_var = vars.contains_key("env");
	let env = vars
		.into_iter()
		.map(|(key, value)| (BString::from(key), BString::from(value)))
		.collect();
	let cwd = config.seed.as_ref().map_or_else(initial_cwd, Image::cwd);
	// The pi utilities (and their `PI_DISABLE_*` gates), the process
	// builtins, `nohup`, `timeout` and the `git` layers are the session's
	// commands (`crate::tools`), configured from this environment; `exec`
	// and `suspend` never act on this process.
	let session_config = SessionConfig {
		env,
		cwd: cwd.clone(),
		fs: Box::new(slot.clone()),
		vfs: Some(slot.clone()),
		runtime,
		output_decoding: None,
	};
	let session = match &config.seed {
		Some(image) => Session::restore(session_config, image),
		None => Session::new(session_config),
	}
	.map_err(|err| Error::msg(format!("Failed to initialize shell: {err}")))?;
	let mut core = ShellSessionCore { session, slot, filesystem: config.filesystem.clone(), cwd };

	// A seed already holds both.
	if config.seed.is_none() {
		if !has_env_var {
			apply_env_fallback(&mut core, &cancel)
				.await
				.map_err(|err| Error::msg(format!("Failed to set env fallback: {err}")))?;
		}
		if let Some(snapshot_path) = config.snapshot_path.as_ref() {
			let escaped = snapshot_path.replace('\'', "'\\''");
			run_setup(&mut core, format!("source '{escaped}'"), &cancel)
				.await
				.map_err(|err| Error::msg(format!("Failed to source snapshot: {err}")))?;
		}
	}
	restore_session_filesystem(&core);
	if cancel.is_cancelled() {
		return Err(Error::msg("Shell setup was cancelled"));
	}
	Ok(core)
<<<<<<< ours — scope `// Process inspection and control (see `pi_bu...` in function `create_session_for_run`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	// Process inspection and control (see `tau_builtins::process_builtins`).
	// `nohup` is withheld when PI_DISABLE_NOHUP_BUILTIN asks for the system one;
	// `kill` already comes from the default set, where our richer implementation
	// replaced brush's.
	for (name, registration) in tau_builtins::process_builtins() {
		if name == "nohup" && nohup_builtin_disabled(config) {
			continue;
		}
		shell.register_builtin(name, registration);
	}
=======
>>>>>>> theirs — scope `// Process inspection and control (see `pi_bu...` deleted in theirs
<<<<<<< ours — scope `// In-process command-line utility builtins (see` in function `create_session_for_run`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	// In-process command-line utility builtins (see
	// `tau_builtins::utility_builtins`): consistent, cross-platform
	// implementations that run without spawning a process and resolve paths
	// against the shell working directory. The whole set can be disabled
	// (falling back to system binaries) via PI_DISABLE_UUTILS_BUILTINS; the
	// destructive trio additionally honors PI_DISABLE_UUTILS_DESTRUCTIVE, and
	// `rm`/`mv` have their own switches.
	if !uutils_env_disabled(config, "PI_DISABLE_UUTILS_BUILTINS") {
		let destructive_disabled = uutils_env_disabled(config, "PI_DISABLE_UUTILS_DESTRUCTIVE");
		let rm_disabled =
			destructive_disabled || uutils_env_disabled(config, "PI_DISABLE_RM_BUILTIN");
		let mv_disabled =
			destructive_disabled || uutils_env_disabled(config, "PI_DISABLE_MV_BUILTIN");
		for (name, registration) in tau_builtins::utility_builtins() {
			let disabled = match name {
				"rm" => rm_disabled,
				"mv" => mv_disabled,
				// ln can clobber existing files via -f; gate it with the destructive set.
				"ln" => destructive_disabled,
				_ => false,
			};
			if !disabled {
				shell.register_builtin(name, registration);
			}
		}
	}
=======
>>>>>>> theirs — scope `// In-process command-line utility builtins (see` deleted in theirs
}

/// Run a setup command of a new session with null stdio.
async fn run_setup(
	core: &mut ShellSessionCore,
	command: String,
	cancel: &CancellationToken,
) -> Result<()> {
	let outcome = core
		.session
		.run_with(RunOptions::new(command), null_stdio()?, cancel.clone())
		.await?;
	core.cwd = outcome.cwd;
	Ok(())
}
<<<<<<< ours — function `source_snapshot` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
async fn source_snapshot(
	shell: &mut BrushShell,
	snapshot_path: &str,
	spawn_registry: Option<Arc<process::SpawnRegistry>>,
	cancel_token: Option<CancellationToken>,
) -> Result<()> {
	let mut params = shell.default_exec_params();
	let source_info = SourceInfo::from("tau-natives:snapshot");
	params.set_fd(OpenFiles::STDIN_FD, null_file()?);
	params.set_fd(OpenFiles::STDOUT_FD, null_file()?);
	params.set_fd(OpenFiles::STDERR_FD, null_file()?);
	if let Some(cancel_token) = cancel_token {
		params.set_cancel_token(cancel_token);
	}
	if let Some(spawn_registry) = spawn_registry {
		params.set_spawn_observer(spawn_registry);
	}

	let escaped = snapshot_path.replace('\'', "'\\''");
	let command = format!("source '{escaped}'");
	shell
		.run_string(command, &source_info, &params)
		.await
		.map_err(|err| Error::msg(format!("Failed to source snapshot: {err}")))?;
	Ok(())
}
=======
>>>>>>> theirs — function `source_snapshot` (S+F, confidence: low)

/// Define `env` as a shell variable expanding to the literal `$env` so that
/// POSIX parameter expansion preserves PowerShell-style `$env:NAME`
/// references when commands are dispatched to a PowerShell (or any)
/// subprocess. The variable is not exported, so it only influences the
/// shell's own expansion; the child process environment is unaffected.
///
/// User-driven assignments (`env=prod; echo "$env:8080"`) replace this
/// default, preserving the bash POSIX contract for callers that genuinely use
/// a variable named `env`.
async fn apply_env_fallback(core: &mut ShellSessionCore, cancel: &CancellationToken) -> Result<()> {
	run_setup(core, "env='$env'".to_owned(), cancel).await
}

fn is_macos_malloc_stack_logging_var(key: &str) -> bool {
	matches!(key, "MallocStackLogging" | "MallocStackLoggingNoCompact")
}

fn should_skip_env_var(key: &str) -> bool {
	if key.starts_with("BASH_FUNC_") && key.ends_with("%%") {
		return true;
	}
	if is_macos_malloc_stack_logging_var(key) {
		return true;
	}

	matches!(
		key,
		"BASH_ENV"
			| "ENV"
			| "HISTFILE"
			| "HISTTIMEFORMAT"
			| "HISTCMD"
			| "PS0"
			| "PS1"
			| "PS2"
			| "PS4"
			| "READLINE_LINE"
			| "READLINE_POINT"
			| "BASH"
			| "BASHOPTS"
			| "BASH_ALIASES"
			| "BASH_ARGV0"
			| "BASH_CMDS"
			| "BASH_SOURCE"
			| "BASH_SUBSHELL"
			| "BASH_VERSINFO"
			| "BASH_VERSION"
			| "SHELLOPTS"
			| "SHLVL"
			| "SHELL"
			| "COMP_WORDBREAKS"
			| "DIRSTACK"
			| "EPOCHREALTIME"
			| "EPOCHSECONDS"
			| "FUNCNAME"
			| "GROUPS"
			| "IFS"
			| "LINENO"
			| "MACHTYPE"
			| "OSTYPE"
			| "OPTERR"
			| "OPTIND"
			| "PIPESTATUS"
			| "PPID"
			| "PWD"
			| "OLDPWD"
			| "RANDOM"
			| "SRANDOM"
			| "SECONDS"
			| "UID"
			| "EUID"
			| "HOSTNAME"
			| "HOSTTYPE"
	)
}

/// The per-command environment: exported to this command only, each name
/// back to its previous value afterwards.
fn command_env(env: Option<&HashMap<String, String>>) -> Vec<(BString, BString)> {
	env.into_iter()
		.flatten()
		.filter_map(|(key, value)| {
			let key = normalize_env_key(key);
			(!should_skip_env_var(key)).then(|| (BString::from(key), BString::from(value.as_str())))
		})
		.collect()
}

#[derive(Clone, Copy)]
enum CommandCaptureMode {
	Streaming,
	Buffered { max_capture_bytes: usize },
}

/// How one session run of a command ended.
struct CommandRunOutput {
	outcome:        RunOutcome,
	buffered:       Option<BufferedOutput>,
	/// A command reported an error yet went on, so the exit status hides it.
	reported_error: bool,
}

/// What every session run of one command shares.
struct CommandScope<'a> {
	options: &'a ShellRunConfig,
	env:     Vec<(BString, BString)>,
	cancel:  CancellationToken,
}

impl CommandScope<'_> {
	/// The session run of `command`; `cwd` moves the shell first.
	fn run_options(
		&self,
		command: String,
		cwd: Option<BString>,
		reported_error: Option<Arc<AtomicBool>>,
	) -> RunOptions {
		RunOptions {
			command,
			env: self.env.clone(),
			cwd,
			pipe_tap: self
				.options
				.pipe_taps
				.as_ref()
				.map(|taps| Arc::clone(taps) as Arc<dyn crate::bash::PipeTap>),
			reported_error,
			text_capture: false,
			events: self
				.options
				.trace
				.as_ref()
				.map(|trace| Arc::clone(trace) as Arc<dyn crate::bash::EventSink>),
		}
	}
}

struct ChainCapture {
	original_text: String,
	text:          String,
	input_bytes:   usize,
	changed:       bool,
}

impl ChainCapture {
	const fn new() -> Self {
		Self {
			original_text: String::new(),
			text:          String::new(),
			input_bytes:   0,
			changed:       false,
		}
	}

	fn push(&mut self, original: &str, original_input_bytes: usize, minimized: &str, changed: bool) {
		self.original_text.push_str(original);
		self.text.push_str(minimized);
		self.input_bytes = self.input_bytes.saturating_add(original_input_bytes);
		self.changed |= changed;
	}
}

/// Install the run's filesystem — its override, else the session's — scoped
/// to the run's cancellation, so an aborted run stops waiting on provider
/// calls.
fn install_run_filesystem(
	session: &ShellSessionCore,
	options: &ShellRunConfig,
	cancel_token: &CancellationToken,
) {
	let filesystem = options
		.filesystem
		.as_ref()
		.unwrap_or(&session.filesystem)
		.with_cancellation(cancel_token.clone());
	session.slot.set_filesystem(filesystem);
}

/// Put the session filesystem back so a run's override never leaks into
/// later runs (or into the background jobs it left running).
fn restore_session_filesystem(session: &ShellSessionCore) {
	session.slot.set_filesystem(session.filesystem.clone());
}

/// Wait for the closes of virtual files the command dropped, so its writes
/// have settled before the run reports. Cancellation ends the wait, never the
/// closes themselves.
async fn drain_dropped_files(slot: &VfsFs, cancel_token: &CancellationToken) -> io::Result<()> {
	let filesystem = slot.filesystem();
	tokio::select! {
		drained = filesystem.drain_closes() => drained,
		() = cancel_token.cancelled() => Ok(()),
	}
}

/// A failed close lost data the command believed written: say so on the
/// command's stderr and fail a command that otherwise succeeded.
fn report_close_failure(
	stderr: &mut fs::File,
	err: &io::Error,
	result: &mut std::result::Result<RunOutcome, SessionError>,
) {
	use std::io::Write as _;
	let _ = writeln!(stderr, "pi-shell: closing a file failed: {err}");
	if let Ok(outcome) = result
		&& outcome.status == 0
	{
		outcome.status = 1;
	}
}

async fn run_shell_command(
	session: &mut ShellSessionCore,
	options: &ShellRunConfig,
	on_chunk: Option<Sender<String>>,
	cancel_token: CancellationToken,
) -> Result<CommandResult> {
	install_run_filesystem(session, options, &cancel_token);
	let result = run_shell_command_in_filesystem(session, options, on_chunk, cancel_token).await;
	restore_session_filesystem(session);
	result
}

async fn run_shell_command_in_filesystem(
	session: &mut ShellSessionCore,
	options: &ShellRunConfig,
	on_chunk: Option<Sender<String>>,
	cancel_token: CancellationToken,
) -> Result<CommandResult> {
	let cwd = requested_cwd(session, options.cwd.as_deref()).await?;
	let scope =
		CommandScope { options, env: command_env(options.env.as_ref()), cancel: cancel_token };

	let minimizer_mode = if let Some(config) = options.minimizer.as_ref() {
		minimizer::engine::mode_for(&options.command, config)
	} else {
		minimizer::engine::MinimizerMode::None
	};

	let (status, minimized) = match minimizer_mode {
		minimizer::engine::MinimizerMode::SegmentedChain => {
			run_shell_command_segmented_chain(session, &scope, cwd, on_chunk).await?
		},
		minimizer::engine::MinimizerMode::WholeCommand | minimizer::engine::MinimizerMode::None => {
			run_shell_command_single(session, &scope, cwd, on_chunk, minimizer_mode).await?
		},
	};

	Ok(CommandResult { status, minimized, working_dir: session.cwd.to_str_lossy().into_owned() })
}

async fn run_shell_command_single(
	session: &mut ShellSessionCore,
	scope: &CommandScope<'_>,
	cwd: Option<BString>,
	on_chunk: Option<Sender<String>>,
	minimizer_mode: minimizer::engine::MinimizerMode,
) -> Result<(i32, Option<MinimizerResult>)> {
	debug_assert!(!matches!(minimizer_mode, minimizer::engine::MinimizerMode::SegmentedChain));
	let options = scope.options;
	let capture_mode = match minimizer_mode {
		minimizer::engine::MinimizerMode::WholeCommand => {
			let Some(config) = options.minimizer.as_ref() else {
				return Err(Error::msg("Missing minimizer config for whole-command mode"));
			};
			CommandCaptureMode::Buffered { max_capture_bytes: config.max_capture_bytes as usize }
		},
		minimizer::engine::MinimizerMode::None => CommandCaptureMode::Streaming,
		minimizer::engine::MinimizerMode::SegmentedChain => CommandCaptureMode::Streaming,
	};

	let command_run = run_shell_command_once(
		session,
		scope,
		options.command.clone(),
		cwd,
		on_chunk,
		capture_mode,
		None,
	)
	.await?;
	let status = command_run.outcome.status;

	let mut minimized_out = None;
	if let Some(buffered) = command_run.buffered
		&& let Some(config) = options.minimizer.as_ref()
	{
		// When the capture cap is exceeded the output was streamed raw and never
		// buffered, so nothing was minimized — leave `minimized` absent, matching
		// every other passthrough path and `apply_shell_minimizer`.
		// A command that reported an error yet exited 0 (jq after an input that
		// fails) is left whole: a filter may cut the error, and its exit-code
		// gate cannot see it.
		if !buffered.exceeded && !command_run.reported_error {
			let minimized = match minimizer_mode {
				minimizer::engine::MinimizerMode::WholeCommand => {
					minimizer::apply(&options.command, &buffered.text, status, config)
				},
				minimizer::engine::MinimizerMode::None => {
					minimizer::MinimizerOutput::passthrough(&buffered.text)
				},
				minimizer::engine::MinimizerMode::SegmentedChain => {
					minimizer::MinimizerOutput::passthrough(&buffered.text)
				},
			};
			// Surface telemetry only when the filter actually rewrote the output
			// and kept the original buffer — same contract as
<<<<<<< ours — scope `{` in function `run_shell_command_single` (T+S+F, confidence: low)
// refused_by: statement_fold · collision: none (1 contested hunk(s), neither side deleted the other's lines)
			// `apply_shell_minimizer` in `tau-natives`. A supported filter that
			// runs but leaves the output unchanged (e.g. a short `git diff
			// --name-only`) reports `changed: false` with no `original_text`
			// and must NOT set `minimized`, or API consumers keying off
			// `result.minimized` are misled. The separate `too-large` reason
			// path above is unaffected.
=======
			// `apply_shell_minimizer` in `pi-natives`. A supported filter that
			// runs but leaves the output unchanged reports `changed: false` with
			// no `original_text` and must NOT set `minimized`.
>>>>>>> theirs — scope `{`
			if minimized.changed
				&& let Some(original_text) = minimized.original_text
			{
				let output_bytes = u32::try_from(minimized.text.len()).unwrap_or(u32::MAX);
				minimized_out = Some(MinimizerResult {
					filter: minimized.filter.to_string(),
					text: minimized.text,
					original_text,
					input_bytes: u32::try_from(minimized.input_bytes).unwrap_or(u32::MAX),
					output_bytes,
				});
			}
		}
	}

	Ok((status, minimized_out))
}

/// The source of a chain segment whose failure must not trip `set -e`: the
/// left side of `&&`, where bash ignores errexit. `&& :` puts the segment in
/// that position without changing its status, and the braces keep a trailing
/// comment from swallowing it.
fn errexit_suppressed(command: &str) -> String {
	format!("{{ {command}\n}} && :")
}

async fn run_shell_command_segmented_chain(
	session: &mut ShellSessionCore,
	scope: &CommandScope<'_>,
	cwd: Option<BString>,
	on_chunk: Option<Sender<String>>,
) -> Result<(i32, Option<MinimizerResult>)> {
	let options = scope.options;
	let unsegmented = minimizer::engine::MinimizerMode::None;
	let Some(config) = options.minimizer.as_ref() else {
		return run_shell_command_single(session, scope, cwd, on_chunk, unsegmented).await;
	};

	// When minimizer is disabled, don't segment — stream the original single
	// path.
	if !config.enabled {
		return run_shell_command_single(session, scope, cwd, on_chunk, unsegmented).await;
	}

	let minimizer::plan::CommandPlan::Chain { segments } =
		minimizer::plan::analyze(&options.command)
	else {
		return run_shell_command_single(session, scope, cwd, on_chunk, unsegmented).await;
	};

	let mut cwd = cwd;
	let mut aggregate = Some(ChainCapture::new());
	let mut previous_succeeded = true;
	let mut last_status = None;
	let max_capture_bytes = config.max_capture_bytes as usize;
	for segment in segments {
		if segment.run_if_previous_succeeded && !previous_succeeded {
			continue;
		}

		let capture_mode = if aggregate.is_some() {
			CommandCaptureMode::Buffered { max_capture_bytes }
		} else {
			CommandCaptureMode::Streaming
		};
		let source = if segment.suppress_errexit {
			errexit_suppressed(&segment.command)
		} else {
			segment.command.clone()
		};

		// Only the first segment moves the shell; later ones start wherever
		// the earlier ones left it.
		let events = options.trace.as_ref().map(|trace| {
			trace.segment(SegmentSource {
				at:     segment.source_at,
				len:    segment.source_len,
				prefix: if segment.suppress_errexit { 2 } else { 0 },
			})
		});
		let command_run = run_shell_command_once(
			session,
			scope,
			source,
			cwd.take(),
			on_chunk.clone(),
			capture_mode,
			events,
		)
		.await?;

		let exit = command_run.outcome.status;
		previous_succeeded = exit == 0;

		if let Some(buffered) = command_run.buffered {
			if buffered.exceeded {
				// Cap exceeded mid-chain: output streamed raw, drop the buffered
				// aggregate so the remaining segments stream too. No minimization
				// happened, so we emit no `minimized` telemetry (see below).
				aggregate = None;
			} else if let Some(capture) = aggregate.as_mut() {
				let next_input_bytes = capture.input_bytes.saturating_add(buffered.input_bytes);
				if next_input_bytes > max_capture_bytes {
					aggregate = None;
				} else {
					let minimized = if command_run.reported_error {
						minimizer::MinimizerOutput::passthrough(&buffered.text)
					} else {
						minimizer::apply(&segment.command, &buffered.text, exit, config)
					};
					capture.push(
						&buffered.text,
						buffered.input_bytes,
						&minimized.text,
						minimized.changed,
					);
				}
			}
		} else if aggregate.is_some() {
			aggregate = None;
		}

		// `exit` and errexit end the command (the session itself stays usable).
		let keep_running = !command_run.outcome.exited && !scope.cancel.is_cancelled();
		last_status = Some(exit);
		if !keep_running {
			break;
		}
	}

	let Some(status) = last_status else {
		return Err(Error::msg("Segmented chain executed no segments"));
	};

	if let Some(trace) = options.trace.as_ref() {
		trace.finish_segments(status);
	}

	let minimized_out = aggregate
		// Only surface telemetry when the segmented chain actually rewrote the
		// output; a `chain-noop` capture (`changed == false`) must yield `None`,
		// matching the public `ShellRunResult.minimized` contract.
		.filter(|capture| capture.changed)
		.map(|capture| {
			let minimized = minimizer::chain_output(
				capture.text,
				capture.original_text,
				capture.input_bytes,
				capture.changed,
			);
			MinimizerResult {
				filter:        minimized.filter.to_string(),
				text:          minimized.text,
				original_text: minimized.original_text.unwrap_or_default(),
				input_bytes:   u32::try_from(minimized.input_bytes).unwrap_or(u32::MAX),
				output_bytes:  u32::try_from(minimized.output_bytes).unwrap_or(u32::MAX),
			}
		});
	// A chain that overflowed the aggregate cap streamed its output raw and was
	// not minimized — `minimized_out` stays `None`, matching the whole-command
	// path and `apply_shell_minimizer`.

	Ok((status, minimized_out))
}

/// Run `command` once on the session, its stdout and stderr merged into one
/// pipe that is decoded into `on_chunk`.
async fn run_shell_command_once(
	session: &mut ShellSessionCore,
	scope: &CommandScope<'_>,
	mut command: String,
	cwd: Option<BString>,
	on_chunk: Option<Sender<String>>,
	capture_mode: CommandCaptureMode,
	events: Option<Arc<dyn crate::bash::EventSink>>,
) -> Result<CommandRunOutput> {
	let cancel_token = scope.cancel.clone();
	let (reader_file, writer_file) = pipe_to_files("output")?;

	let stdout_file = writer_file
		.try_clone()
		.map_err(|err| Error::msg(format!("Failed to clone pipe: {err}")))?;
	let mut diagnostics = writer_file
		.try_clone()
		.map_err(|err| Error::msg(format!("Failed to clone pipe: {err}")))?;
	let stdio =
		RunStdio { stdin: Some(null_file()?), stdout: Some(stdout_file), stderr: Some(writer_file) };
	// Only a buffered capture can be minimized, so only it asks for the report.
	let reported_error = matches!(capture_mode, CommandCaptureMode::Buffered { .. })
		.then(|| Arc::new(AtomicBool::new(false)));
	let reader_cancel = CancellationToken::new();
	let (activity_tx, activity_rx) = flume::bounded::<()>(1);
	let reader_callback = on_chunk;
	let mut reader_handle = tokio::spawn({
		let reader_cancel = reader_cancel.clone();
		async move {
			match capture_mode {
				CommandCaptureMode::Buffered { max_capture_bytes } => {
					let output = read_output_buffered(
						reader_file,
						reader_callback,
						reader_cancel,
						activity_tx,
						max_capture_bytes,
					)
					.await;
					Result::<OutputRead>::Ok(OutputRead::Buffered(output))
				},
				CommandCaptureMode::Streaming => {
					Box::pin(read_output(reader_file, reader_callback, reader_cancel, activity_tx))
						.await;
					Result::<OutputRead>::Ok(OutputRead::Streaming)
				},
			}
		}
	});
	let cancel_bridge = tokio::spawn({
		let cancel_token = cancel_token.clone();
		let reader_cancel = reader_cancel.clone();
		async move {
			cancel_token.cancelled().await;
			time::sleep(CANCEL_READER_GRACE).await;
			reader_cancel.cancel();
		}
	});
	ensure_trailing_newline_for_heredoc(&mut command);
	let mut run = scope.run_options(command, cwd, reported_error.clone());
	if let Some(events) = events {
		run.events = Some(events);
	}
	// Stdout and stderr are one pipe read as text: externals' output is
	// decoded per program before it joins what the builtins wrote.
	run.text_capture = true;
	let mut result = session
		.session
		.run_with(run, stdio, cancel_token.clone())
		.await;
	if let Ok(outcome) = &result {
		session.cwd.clone_from(&outcome.cwd);
	}

	if let Err(err) = drain_dropped_files(&session.slot, &cancel_token).await {
		report_close_failure(&mut diagnostics, &err, &mut result);
	}
	// Release the extra writer so the reader can reach EOF.
	drop(diagnostics);
<<<<<<< ours — scope `let source_info = SourceInfo::from("pi-native...` in function `run_shell_command_once`, deleted in theirs (S, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	let source_info = SourceInfo::from("tau-natives:command");
=======
>>>>>>> theirs — scope `let source_info = SourceInfo::from("pi-native...` deleted in theirs

	// The foreground command can complete while background jobs keep the
	// stdout/stderr pipe open. Don't hang forever waiting for EOF; drain output
	// for a short period, then cancel. A cancelled run is the exception: the
	// processes its cancel signalled may still be running their TERM traps, so
	// the reader stays open until they close the pipe or the cancel bridge
	// releases it (`CANCEL_READER_GRACE`).
	const POST_EXIT_IDLE: Duration = Duration::from_millis(250);
	const POST_EXIT_MAX: Duration = Duration::from_secs(2);
	const READER_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(250);

	let cancelled = cancel_token.is_cancelled();

	let mut reader_finished = false;
	let mut reader_output = None;
	let mut idle_timer = Box::pin(time::sleep(POST_EXIT_IDLE));
	let mut max_timer = Box::pin(time::sleep(POST_EXIT_MAX));

	loop {
		tokio::select! {
			res = &mut reader_handle => {
				if let Ok(Ok(output)) = res {
					reader_output = Some(output);
				}
				reader_finished = true;
				break;
			}
			msg = activity_rx.recv_async() => {
				if msg.is_err() {
					break;
				}
				idle_timer.as_mut().reset(time::Instant::now() + POST_EXIT_IDLE);
			}
			() = &mut idle_timer, if !cancelled => break,
			() = &mut max_timer, if !cancelled => break,
		}
	}

	if !reader_finished {
		reader_cancel.cancel();
		match time::timeout(READER_SHUTDOWN_TIMEOUT, &mut reader_handle).await {
			Ok(Ok(Ok(output))) => reader_output = Some(output),
			Ok(_) => {},
			Err(_) => {
				reader_handle.abort();
				let _ = reader_handle.await;
			},
		}
	}
	cancel_bridge.abort();
	let _ = cancel_bridge.await;

	let outcome = result.map_err(|err| Error::msg(format!("Shell execution failed: {err}")))?;
	let buffered = match reader_output {
		Some(OutputRead::Buffered(output)) => Some(output),
		Some(OutputRead::Streaming) | None => None,
	};
	let reported_error = reported_error.is_some_and(|flag| flag.load(Ordering::Relaxed));
	Ok(CommandRunOutput { outcome, buffered, reported_error })
}

async fn run_shell_command_streams(
	session: &mut ShellSessionCore,
	options: &ShellRunConfig,
	streams: StreamSinks,
	cancel_token: CancellationToken,
) -> Result<CommandResult> {
	install_run_filesystem(session, options, &cancel_token);
	restore_session_filesystem(session);
	result
<<<<<<< ours — scope `let source_info = SourceInfo::from("pi-shell:...` in function `run_shell_command_streams`, deleted in theirs (S, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	let source_info = SourceInfo::from("tau-shell:streams");
=======
>>>>>>> theirs — scope `let source_info = SourceInfo::from("pi-shell:...` deleted in theirs
	let result =
		run_shell_command_streams_in_filesystem(session, options, streams, cancel_token).await;
}

async fn run_shell_command_streams_in_filesystem(
	session: &mut ShellSessionCore,
	options: &ShellRunConfig,
	streams: StreamSinks,
	cancel_token: CancellationToken,
) -> Result<CommandResult> {
	let cwd = requested_cwd(session, options.cwd.as_deref()).await?;
	let scope = CommandScope {
		options,
		env: command_env(options.env.as_ref()),
		cancel: cancel_token.clone(),
	};

	let (stdout_reader, stdout_writer) = pipe_to_files("stdout")?;
	let (stderr_reader, stderr_writer) = pipe_to_files("stderr")?;

	let mut diagnostics = stderr_writer
		.try_clone()
		.map_err(|err| Error::msg(format!("Failed to clone pipe: {err}")))?;
	let stdio = RunStdio {
		stdin:  Some(null_file()?),
		stdout: Some(stdout_writer),
		stderr: Some(stderr_writer),
	};
	let reader_cancel = CancellationToken::new();
	let (activity_tx, activity_rx) = flume::bounded::<()>(1);

	let StreamSinks { stdout: stdout_sink, stderr: stderr_sink } = streams;
	let mut stdout_handle = tokio::spawn(Box::pin(read_output_bytes(
		stdout_reader,
		stdout_sink,
		reader_cancel.clone(),
		activity_tx.clone(),
	)));
	let mut stderr_handle = tokio::spawn(Box::pin(read_output_bytes(
		stderr_reader,
		stderr_sink,
		reader_cancel.clone(),
		activity_tx,
	)));

	let cancel_bridge = tokio::spawn({
		let cancel_token = cancel_token.clone();
		let reader_cancel = reader_cancel.clone();
		async move {
			cancel_token.cancelled().await;
			time::sleep(CANCEL_READER_GRACE).await;
			reader_cancel.cancel();
		}
	});
	let mut command = options.command.clone();
	ensure_trailing_newline_for_heredoc(&mut command);
	let run = scope.run_options(command, cwd, None);
	let mut result = session
		.session
		.run_with(run, stdio, cancel_token.clone())
		.await;
	if let Ok(outcome) = &result {
		session.cwd.clone_from(&outcome.cwd);
	}

	if let Err(err) = drain_dropped_files(&session.slot, &cancel_token).await {
		report_close_failure(&mut diagnostics, &err, &mut result);
	}
	// Release the extra writer so the stderr reader can reach EOF.
	drop(diagnostics);

	// As in `run_shell_command_once`: a short drain after the run, except
	// that a cancelled run's readers stay open for its TERM traps until the
	// cancel bridge releases them.
	const POST_EXIT_IDLE: Duration = Duration::from_millis(250);
	const POST_EXIT_MAX: Duration = Duration::from_secs(2);
	const READER_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(250);

	let cancelled = cancel_token.is_cancelled();
	let mut stdout_finished = false;
	let mut stderr_finished = false;
	let mut idle_timer = Box::pin(time::sleep(POST_EXIT_IDLE));
	let mut max_timer = Box::pin(time::sleep(POST_EXIT_MAX));

	loop {
		if stdout_finished && stderr_finished {
			break;
		}
		tokio::select! {
			res = &mut stdout_handle, if !stdout_finished => {
				let _ = res;
				stdout_finished = true;
			}
			res = &mut stderr_handle, if !stderr_finished => {
				let _ = res;
				stderr_finished = true;
			}
			msg = activity_rx.recv_async() => {
				if msg.is_err() {
					break;
				}
				idle_timer.as_mut().reset(time::Instant::now() + POST_EXIT_IDLE);
			}
			() = &mut idle_timer, if !cancelled => break,
			() = &mut max_timer, if !cancelled => break,
		}
	}

	if !stdout_finished || !stderr_finished {
		reader_cancel.cancel();
	}
	if !stdout_finished
		&& time::timeout(READER_SHUTDOWN_TIMEOUT, &mut stdout_handle)
			.await
			.is_err()
	{
		stdout_handle.abort();
		let _ = stdout_handle.await;
	}
	if !stderr_finished
		&& time::timeout(READER_SHUTDOWN_TIMEOUT, &mut stderr_handle)
			.await
			.is_err()
	{
		stderr_handle.abort();
		let _ = stderr_handle.await;
	}
	cancel_bridge.abort();
	let _ = cancel_bridge.await;

	let outcome = result.map_err(|err| Error::msg(format!("Shell execution failed: {err}")))?;
	Ok(CommandResult {
		status:      outcome.status,
		minimized:   None,
		working_dir: session.cwd.to_str_lossy().into_owned(),
	})
}

async fn read_output_bytes(
	reader: fs::File,
	sink: Option<Sender<Bytes>>,
	cancel_token: CancellationToken,
	activity: Sender<()>,
) {
	const BUF: usize = 65536;

	#[cfg(unix)]
	let Ok(reader) = register_nonblocking_pipe(reader) else {
		return;
	};
	#[cfg(not(unix))]
	let mut reader = tokio::fs::File::from_std(reader);

	loop {
		let mut buf = vec![0u8; BUF];
		#[cfg(unix)]
		let n = {
			let Ok(mut readiness) = (tokio::select! {
				ready = reader.readable() => ready,
				() = cancel_token.cancelled() => break,
			}) else {
				break;
			};
			match readiness.try_io(|inner| read_nonblocking(inner.get_ref(), &mut buf)) {
				Ok(Ok(0)) => break,
				Ok(Ok(n)) => n,
				Ok(Err(e)) if e.kind() == io::ErrorKind::Interrupted => continue,
				Ok(Err(_)) => break,
				Err(_would_block) => continue,
			}
		};
		#[cfg(not(unix))]
		let n = {
			let read_future = reader.read(&mut buf);
			tokio::pin!(read_future);
			match tokio::select! {
				res = &mut read_future => res,
				() = cancel_token.cancelled() => break,
			} {
				Ok(0) => break,
				Ok(n) => n,
				Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
				Err(_) => break,
			}
		};
		let _ = activity.try_send(());
		buf.truncate(n);
		if let Some(sink) = sink.as_ref()
			&& sink.send(Bytes::from(buf)).is_err()
		{
			// Receiver dropped — stop forwarding and let the pipe close.
			break;
		}
	}
}
<<<<<<< ours — constant `GIT_REPO_LOCATION_ENV_VARS` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// Git variables that pin a repository location to the launch checkout.
///
/// Forwarding them into a shell makes `git` ignore the command's working
/// directory and mutate the wrong worktree or index, so the shell rediscovers
/// the repository from `cwd` instead. Mirrors the `env_remove` list in
/// `crates/tau-vcs/src/git/cli.rs`.
pub const GIT_REPO_LOCATION_ENV_VARS: [&str; 6] = [
	"GIT_DIR",
	"GIT_COMMON_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
=======
>>>>>>> theirs — constant `GIT_REPO_LOCATION_ENV_VARS` (S+F, confidence: low)

fn ensure_trailing_newline_for_heredoc(command: &mut String) {
	if command.ends_with('\n')
		|| !command
			.as_bytes()
			.array_windows()
			.any(|window| window == b"<<")
	{
		return;
	}
	command.push('\n');
}

enum OutputRead {
	Streaming,
	Buffered(BufferedOutput),
}

struct BufferedOutput {
	text:        String,
	input_bytes: usize,
	exceeded:    bool,
}

/// How long the capture reader waits for the rest of a held line before
/// judging what it has (a prompt or progress text without a newline).
#[cfg(not(unix))]
const CAPTURE_LINE_IDLE: Duration = Duration::from_millis(50);

/// Completes after [`CAPTURE_LINE_IDLE`] when `holds_line`, never otherwise.
#[cfg(not(unix))]
async fn capture_line_idle(holds_line: bool) {
	if holds_line {
		time::sleep(CAPTURE_LINE_IDLE).await;
	} else {
		std::future::pending::<()>().await;
	}
}

async fn read_output(
	reader: fs::File,
	on_chunk: Option<Sender<String>>,
	cancel_token: CancellationToken,
	activity: Sender<()>,
) {
	const BUF: usize = 65536;
	let mut buf = vec![0u8; BUF];
	let mut decoder = CaptureDecoder::new();

	#[cfg(unix)]
	let Ok(reader) = register_nonblocking_pipe(reader) else {
		return;
	};
	#[cfg(not(unix))]
	let reader = tokio::fs::File::from_std(reader);
	#[cfg(not(unix))]
	tokio::pin!(reader);

	loop {
		#[cfg(unix)]
		let n = {
			let Ok(mut readiness) = (tokio::select! {
				ready = reader.readable() => ready,
				() = cancel_token.cancelled() => break,
			}) else {
				break;
			};
			match readiness.try_io(|inner| read_nonblocking(inner.get_ref(), &mut buf)) {
				Ok(Ok(0)) => break,
				Ok(Ok(n)) => n,
				Ok(Err(e)) if e.kind() == io::ErrorKind::Interrupted => continue,
				Ok(Err(_)) => break,
				Err(_would_block) => continue,
			}
		};
		#[cfg(not(unix))]
		let n = {
			let read_future = reader.read(&mut buf);
			tokio::pin!(read_future);
			let res = loop {
				tokio::select! {
					res = &mut read_future => break Some(res),
					() = cancel_token.cancelled() => break None,
					() = capture_line_idle(decoder.holds_line()) => {
						emit_chunk(decoder.flush_line(), on_chunk.as_ref()).await;
					}
				}
			};
			let Some(res) = res else {
				break;
			};
			match res {
				Ok(0) => break, // EOF
				Ok(n) => n,
				Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
				Err(_) => break,
			}
		};
		if n > 0 {
			let _ = activity.try_send(());
			let text = decoder.push(&buf[..n]);
			if !text.is_empty() {
				emit_chunk(text, on_chunk.as_ref()).await;
			}
		}
	}

	let rest = decoder.finish();
	if !rest.is_empty() {
		emit_chunk(rest, on_chunk.as_ref()).await;
	}
}

async fn read_output_buffered(
	reader: fs::File,
	on_chunk: Option<Sender<String>>,
	cancel_token: CancellationToken,
	activity: Sender<()>,
	max_capture_bytes: usize,
) -> BufferedOutput {
	const BUF: usize = 65536;
	let mut buf = vec![0u8; BUF];
	let mut input_bytes = 0usize;
	// The decoded capture, built from the same decoder output that streams,
	// so the bytes are decoded once rather than again at the end.
	let mut captured = String::new();
	let mut captured_bytes = 0usize;
	let mut exceeded = false;
	let mut decoder = CaptureDecoder::new();

	#[cfg(unix)]
	let Ok(reader) = register_nonblocking_pipe(reader) else {
		return BufferedOutput { text: String::new(), input_bytes: 0, exceeded: true };
	};
	#[cfg(not(unix))]
	let reader = tokio::fs::File::from_std(reader);
	#[cfg(not(unix))]
	tokio::pin!(reader);

	loop {
		#[cfg(unix)]
		let n = {
			let Ok(mut readiness) = (tokio::select! {
				ready = reader.readable() => ready,
				() = cancel_token.cancelled() => break,
			}) else {
				break;
			};
			match readiness.try_io(|inner| read_nonblocking(inner.get_ref(), &mut buf)) {
				Ok(Ok(0)) => break,
				Ok(Ok(n)) => n,
				Ok(Err(e)) if e.kind() == io::ErrorKind::Interrupted => continue,
				Ok(Err(_)) => break,
				Err(_would_block) => continue,
			}
		};
		#[cfg(not(unix))]
		let n = {
			let read_future = reader.read(&mut buf);
			tokio::pin!(read_future);
			let res = loop {
				tokio::select! {
					res = &mut read_future => break Some(res),
					() = cancel_token.cancelled() => break None,
					() = capture_line_idle(decoder.holds_line()) => {
						let text = decoder.flush_line();
						if !exceeded {
							captured.push_str(&text);
						}
						emit_chunk(text, on_chunk.as_ref()).await;
					}
				}
			};
			let Some(res) = res else {
				break;
			};
			match res {
				Ok(0) => break,
				Ok(n) => n,
				Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
				Err(_) => break,
			}
		};
		if n > 0 {
			let _ = activity.try_send(());
			input_bytes = input_bytes.saturating_add(n);
		}
		// Once `exceeded`, the post-process minimizer is bypassed (see the
		// `!output.exceeded` gate at the call site), so the capture serves no
		// purpose. Drop it to bound peak memory on commands that produce very
		// large output.
		if !exceeded && captured_bytes.saturating_add(n) > max_capture_bytes {
			exceeded = true;
			captured.clear();
			captured.shrink_to_fit();
		}
		captured_bytes = captured_bytes.saturating_add(n);

		let text = decoder.push(&buf[..n]);
		if !text.is_empty() {
			if !exceeded {
				captured.push_str(&text);
			}
			emit_chunk(text, on_chunk.as_ref()).await;
		}
	}

	let rest = decoder.finish();
	if !rest.is_empty() {
		if !exceeded {
			captured.push_str(&rest);
		}
		emit_chunk(rest, on_chunk.as_ref()).await;
	}

	BufferedOutput { text: captured, input_bytes, exceeded }
}

#[cfg(unix)]
fn register_nonblocking_pipe(reader: fs::File) -> io::Result<tokio::io::unix::AsyncFd<fs::File>> {
	set_nonblocking(&reader)?;
	tokio::io::unix::AsyncFd::new(reader)
}

#[cfg(unix)]
fn set_nonblocking<T: std::os::fd::AsRawFd>(file: &T) -> io::Result<()> {
	let fd = file.as_raw_fd();
	// SAFETY: `fd` is owned by `file` and remains valid for the duration of
	// these `fcntl` calls.
	let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
	if flags < 0 {
		return Err(io::Error::last_os_error());
	}
	if flags & libc::O_NONBLOCK != 0 {
		return Ok(());
	}

	// SAFETY: `fd` remains valid here and we are only toggling `O_NONBLOCK`.
	let result = unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
	(result >= 0).ok_or_else(io::Error::last_os_error)
}

#[cfg(unix)]
fn read_nonblocking<T: std::os::fd::AsRawFd>(file: &T, buf: &mut [u8]) -> io::Result<usize> {
	// SAFETY: `buf` is writable for `buf.len()` bytes, and the raw fd obtained
	// from `file` stays valid for the duration of the syscall.
	let read = unsafe { libc::read(file.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len()) };
	if read < 0 {
		Err(io::Error::last_os_error())
	} else {
		Ok(read as usize)
	}
}

/// Forward one decoded chunk to the streaming callback, honouring channel
/// backpressure: on a bounded channel (the tau-natives JS bridge) the send
/// parks until the consumer frees a slot — which parks the pipe reader and,
/// transitively, the child on its stdout/stderr pipe — so a fast producer
/// can never buffer unbounded output in memory (#4078). A disconnected
/// receiver (consumer gone) fails immediately, so the pipe keeps draining
/// and the child never wedges on a full pipe.
async fn emit_chunk(text: String, callback: Option<&Sender<String>>) {
	if let Some(callback) = callback {
		let _ = callback.send_async(text).await;
	}
}

fn pipe_to_files(label: &str) -> Result<(fs::File, fs::File)> {
	let (r, w) =
		std::io::pipe().map_err(|err| Error::msg(format!("Failed to create {label} pipe: {err}")))?;

	#[cfg(unix)]
	use std::os::fd::OwnedFd as Owned;
	#[cfg(windows)]
	use std::os::windows::io::OwnedHandle as Owned;

	Ok((fs::File::from(Owned::from(r)), fs::File::from(Owned::from(w))))
}

#[cfg(test)]
mod tests;

	/// Hermetic test environment: explicitly clears the PI_DISABLE_* builtin
	/// kill-switches so tests do not inherit them from the ambient developer
	/// environment (e.g. ~/.profile). A "0" value forces the builtin on per
	/// `uutils_env_disabled`.
	fn hermetic_test_env() -> std::collections::HashMap<String, String> {
		[
			("PI_DISABLE_UUTILS_BUILTINS", "0"),
			("PI_DISABLE_UUTILS_DESTRUCTIVE", "0"),
			("PI_DISABLE_RM_BUILTIN", "0"),
			("PI_DISABLE_MV_BUILTIN", "0"),
			("PI_DISABLE_NOHUP_BUILTIN", "0"),
		]
		.into_iter()
		.map(|(k, v)| (k.to_string(), v.to_string()))
		.collect()
	}

<<<<<<< ours — scope `/// The per-session env overlay is built from...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The per-session env overlay is built from the same host environment, so
	/// it must not reintroduce the repo-location overrides.
	#[tokio::test(flavor = "multi_thread")]
	async fn session_env_does_not_export_git_repo_location_overrides() {
		let dir = tempfile::tempdir().expect("probe directory");
		let out = dir.path().join("probe");
		let mut env = HashMap::new();
		env.insert("GIT_DIR".to_string(), "/primary/.git".to_string());
		env.insert("TAU_GIT_ENV_PROBE".to_string(), "kept".to_string());
		let config =
			ShellConfig { session_env: Some(env), snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null stdout"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null stderr"));

		let command = format!(
			"printf '%s|%s' \"${{GIT_DIR-unset}}\" \"$TAU_GIT_ENV_PROBE\" > {}",
			quote_arg(out.to_str().expect("utf8 probe path"))
		);
		session
			.shell
			.run_string(command, &SourceInfo::from("tau-natives:test"), &params)
			.await
			.expect("run_string");

		assert_eq!(fs::read_to_string(&out).expect("probe output"), "unset|kept");
	}
=======
>>>>>>> theirs — scope `/// The per-session env overlay is built from...` deleted in theirs

<<<<<<< ours — scope `#[cfg(unix)]` in module `tests`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	#[cfg(unix)]
	async fn wait_for_process_name(pid: i32, expected: &str) {
		time::timeout(Duration::from_secs(2), async {
			loop {
				if tau_builtins::ProcInfo::all().into_iter().any(|process| {
					process.pid() == pid
						&& process.match_name() == expected
						&& process.status() == tau_builtins::ProcessStatus::Running
				}) {
					return;
				}
				time::sleep(Duration::from_millis(10)).await;
			}
		})
		.await
		.expect("child did not enter expected executable");
	}
=======
>>>>>>> theirs — scope `#[cfg(unix)]` deleted in theirs

<<<<<<< ours — scope `/// The kill builtin accepts a numeric signal...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The kill builtin accepts a numeric signal and applies it to every process
	/// operand.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn kill_builtin_accepts_numeric_signal_for_multiple_processes() {
		let mut first = Command::new("sleep")
			.arg("30")
			.spawn()
			.expect("first sleep");
		let mut second = Command::new("sleep")
			.arg("30")
			.spawn()
			.expect("second sleep");
		let first_pid = first.id().expect("first pid");
		let second_pid = second.id().expect("second pid");
		let (mut session, params) = kill_test_context().await;
		let source_info = SourceInfo::from("tau-natives:test");

		let result = session
			.shell
			.run_string(format!("kill -9 {first_pid} {second_pid}"), &source_info, &params)
			.await
			.expect("kill command");
		let code = exit_code(&result);
		if code != 0 {
			let _ = first.kill().await;
			let _ = second.kill().await;
			let _ = first.wait().await;
			let _ = second.wait().await;
			assert_eq!(code, 0, "numeric multi-process kill should succeed");
		}

		let statuses =
			time::timeout(Duration::from_secs(5), async { tokio::join!(first.wait(), second.wait()) })
				.await;
		if statuses.is_err() {
			let _ = first.kill().await;
			let _ = second.kill().await;
			let _ = first.wait().await;
			let _ = second.wait().await;
			panic!("kill must signal every process operand");
		}
		let (first_status, second_status) = statuses.expect("checked timeout");
		assert_eq!(first_status.expect("first wait").signal(), Some(libc::SIGKILL));
		assert_eq!(second_status.expect("second wait").signal(), Some(libc::SIGKILL));
	}
=======
>>>>>>> theirs — scope `/// The kill builtin accepts a numeric signal...` deleted in theirs

<<<<<<< ours — scope `/// The kill builtin defaults to SIGTERM so p...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The kill builtin defaults to SIGTERM so processes can shut down
	/// gracefully.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn kill_builtin_defaults_to_sigterm() {
		let dir = tempfile::tempdir().expect("temp dir");
		let ready = dir.path().join("ready");
		let mut child = Command::new("sh")
			.args([
				"-c",
				"trap 'exit 42' TERM; : > \"$1\"; while :; do :; done",
				"sh",
				ready.to_str().expect("utf8 path"),
			])
			.spawn()
			.expect("trapping child");
		let pid = child.id().expect("child pid");
		let ready_result = time::timeout(Duration::from_secs(5), async {
			while !ready.exists() {
				time::sleep(Duration::from_millis(10)).await;
			}
		})
		.await;
		if ready_result.is_err() {
			let _ = child.kill().await;
			let _ = child.wait().await;
			panic!("child did not install its SIGTERM trap");
		}

		let (mut session, params) = kill_test_context().await;
		let source_info = SourceInfo::from("tau-natives:test");
		let result = session
			.shell
			.run_string(format!("kill {pid}"), &source_info, &params)
			.await
			.expect("kill command");
		let code = exit_code(&result);

		let status = time::timeout(Duration::from_secs(5), child.wait()).await;
		if status.is_err() {
			let _ = child.kill().await;
			let _ = child.wait().await;
			panic!("default kill signal did not terminate the child");
		}
		assert_eq!(code, 0, "default kill should succeed");
		assert_eq!(status.expect("checked timeout").expect("child wait").code(), Some(42));
	}
=======
>>>>>>> theirs — scope `/// The kill builtin defaults to SIGTERM so p...` deleted in theirs

<<<<<<< ours — scope `/// A negative PID after `--` targets a proce...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// A negative PID after `--` targets a process group per `kill(2)` instead
	/// of being parsed as a numeric signal, and a plain PID in the same command
	/// is still signaled.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn kill_builtin_preserves_negative_pid_process_group_operands() {
		let dir = tempfile::tempdir().expect("temp dir");
		let group_ready = dir.path().join("group-ready");
		let plain_ready = dir.path().join("plain-ready");
		let spawn_trapping = |ready: &std::path::Path, own_group: bool| {
			let mut cmd = Command::new("sh");
			cmd.args([
				"-c",
				"trap 'exit 42' TERM; : > \"$1\"; while :; do sleep 0.05; done",
				"sh",
				ready.to_str().expect("utf8 path"),
			]);
			if own_group {
				// pgid becomes this child's own pid, so `-pid` addresses the group.
				cmd.process_group(0);
			}
			cmd.spawn().expect("trapping child")
		};

		let mut group_child = spawn_trapping(&group_ready, true);
		let mut plain_child = spawn_trapping(&plain_ready, false);
		let group_pid = group_child.id().expect("group pid");
		let plain_pid = plain_child.id().expect("plain pid");

		let ready_result = time::timeout(Duration::from_secs(5), async {
			while !group_ready.exists() || !plain_ready.exists() {
				time::sleep(Duration::from_millis(10)).await;
			}
		})
		.await;
		if ready_result.is_err() {
			let _ = group_child.start_kill();
			let _ = plain_child.start_kill();
			let _ = group_child.wait().await;
			let _ = plain_child.wait().await;
			panic!("children did not install their SIGTERM traps");
		}

		let (mut session, params) = kill_test_context().await;
		let source_info = SourceInfo::from("tau-natives:test");
		let result = session
			.shell
			.run_string(format!("kill -TERM -- -{group_pid} {plain_pid}"), &source_info, &params)
			.await
			.expect("kill command");
		let code = exit_code(&result);

		let statuses = time::timeout(Duration::from_secs(5), async {
			tokio::join!(group_child.wait(), plain_child.wait())
		})
		.await;
		if statuses.is_err() {
			let _ = group_child.start_kill();
			let _ = plain_child.start_kill();
			let _ = group_child.wait().await;
			let _ = plain_child.wait().await;
			panic!("negative-PID kill must signal the process group and the plain PID");
		}
		let (group_status, plain_status) = statuses.expect("checked timeout");
		assert_eq!(code, 0, "negative-PID kill should succeed");
		assert_eq!(group_status.expect("group wait").code(), Some(42));
		assert_eq!(plain_status.expect("plain wait").code(), Some(42));
	}
=======
>>>>>>> theirs — scope `/// A negative PID after `--` targets a proce...` deleted in theirs

<<<<<<< ours — scope `/// When clap consumes the `--` marker before...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// When clap consumes the `--` marker before `execute` (the default-signal
	/// and `-s SIG` forms), a following negative PID is still an operand, not a
	/// signal: `kill -- -<pgid>` defaults to SIGTERM for the group, and
	/// `kill -s TERM -- -<pgid>` sends the named signal to the group.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn kill_builtin_signals_group_when_marker_precedes_negative_pid() {
		let dir = tempfile::tempdir().expect("temp dir");
		let default_ready = dir.path().join("default-ready");
		let named_ready = dir.path().join("named-ready");
		let spawn_group_leader = |ready: &std::path::Path| {
			Command::new("sh")
				.args([
					"-c",
					"trap 'exit 42' TERM; : > \"$1\"; while :; do sleep 0.05; done",
					"sh",
					ready.to_str().expect("utf8 path"),
				])
				.process_group(0)
				.spawn()
				.expect("group leader")
		};

		let mut default_child = spawn_group_leader(&default_ready);
		let mut named_child = spawn_group_leader(&named_ready);
		let default_pid = default_child.id().expect("default pid");
		let named_pid = named_child.id().expect("named pid");

		let ready_result = time::timeout(Duration::from_secs(5), async {
			while !default_ready.exists() || !named_ready.exists() {
				time::sleep(Duration::from_millis(10)).await;
			}
		})
		.await;
		if ready_result.is_err() {
			let _ = default_child.start_kill();
			let _ = named_child.start_kill();
			let _ = default_child.wait().await;
			let _ = named_child.wait().await;
			panic!("group leaders did not install their SIGTERM traps");
		}

		let (mut session, params) = kill_test_context().await;
		let source_info = SourceInfo::from("tau-natives:test");
		// Default signal (SIGTERM) with the marker consumed by clap.
		let default_result = session
			.shell
			.run_string(format!("kill -- -{default_pid}"), &source_info, &params)
			.await
			.expect("default kill command");
		// Named signal via -s, marker consumed by clap.
		let named_result = session
			.shell
			.run_string(format!("kill -s TERM -- -{named_pid}"), &source_info, &params)
			.await
			.expect("named kill command");

		let statuses = time::timeout(Duration::from_secs(5), async {
			tokio::join!(default_child.wait(), named_child.wait())
		})
		.await;
		if statuses.is_err() {
			let _ = default_child.start_kill();
			let _ = named_child.start_kill();
			let _ = default_child.wait().await;
			let _ = named_child.wait().await;
			panic!("marker-preceded negative PID must signal the process group");
		}
		let (default_status, named_status) = statuses.expect("checked timeout");
		assert_eq!(exit_code(&default_result), 0, "`kill -- -<pgid>` should succeed");
		assert_eq!(exit_code(&named_result), 0, "`kill -s TERM -- -<pgid>` should succeed");
		assert_eq!(default_status.expect("default wait").code(), Some(42));
		assert_eq!(named_status.expect("named wait").code(), Some(42));
	}
=======
>>>>>>> theirs — scope `/// When clap consumes the `--` marker before...` deleted in theirs

<<<<<<< ours — scope `#[cfg(unix)]` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn kill_builtin_signals_every_process_in_a_jobspec_pipeline() {
		const MARKER: &str = "PI_SHELL_TEST_KILL_JOBSPEC_PIPELINE";
		if std::env::var_os(MARKER).is_none() {
			run_isolated_kill_test(
				"shell::tests::kill_builtin_signals_every_process_in_a_jobspec_pipeline",
				MARKER,
				true,
			)
			.await;
			return;
		}

		let dir = tempfile::tempdir().expect("jobspec directory");
		let first_pidfile = dir.path().join("first.pid");
		let second_pidfile = dir.path().join("second.pid");
		let _cleanup = PidfileProcessCleanup(vec![first_pidfile.clone(), second_pidfile.clone()]);
		let first_ready = dir.path().join("first.ready");
		let second_ready = dir.path().join("second.ready");
		let first_script = "trap 'exit 42' TERM; echo $$ > \"$1\"; : > \"$2\"; kill -STOP $$; while \
		                    :; do sleep 0.05; done";
		let second_script = "trap 'exit 43' TERM; echo $$ > \"$1\"; : > \"$2\"; kill -STOP $$; \
		                     while :; do sleep 0.05; done";
		let command = format!(
			"sh -c {} sh {} {} | sh -c {} sh {} {}",
			quote_arg(first_script),
			quote_arg(first_pidfile.to_str().expect("utf8 first pidfile")),
			quote_arg(first_ready.to_str().expect("utf8 first ready path")),
			quote_arg(second_script),
			quote_arg(second_pidfile.to_str().expect("utf8 second pidfile")),
			quote_arg(second_ready.to_str().expect("utf8 second ready path")),
		);
		let (mut session, params) = kill_test_context().await;
		let source_info = SourceInfo::from("tau-natives:test");

		time::timeout(
			Duration::from_secs(5),
			session.shell.run_string(command, &source_info, &params),
		)
		.await
		.expect("pipeline did not stop")
		.expect("stopped pipeline");
		time::timeout(Duration::from_secs(5), async {
			while !first_ready.exists() || !second_ready.exists() {
				time::sleep(Duration::from_millis(10)).await;
			}
		})
		.await
		.expect("pipeline processes did not become ready");
		assert_eq!(
			session
				.shell
				.jobs()
				.current_job()
				.expect("stopped pipeline job")
				.process_ids()
				.count(),
			2,
			"jobspec must retain every external pipeline process",
		);
		let pids = [&first_pidfile, &second_pidfile].map(|pidfile| {
			fs::read_to_string(pidfile)
				.expect("pipeline pidfile")
				.trim()
				.parse::<i32>()
				.expect("pipeline pid")
		});

		let killed = session
			.shell
			.run_string("kill -CONT %1; kill %1", &source_info, &params)
			.await
			.expect("kill jobspec");
		assert_eq!(exit_code(&killed), 0, "`kill %1` should signal every pipeline process");
		let _ = session
			.shell
			.run_string("wait %1", &source_info, &params)
			.await
			.expect("reap jobspec");
		for pid in pids {
			assert!(process::Process::from_pid(pid).is_none(), "pipeline process {pid} survived");
		}
	}
=======
>>>>>>> theirs — scope `#[cfg(unix)]` deleted in theirs

<<<<<<< ours — scope `/// A failed target makes `kill` return non-z...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// A failed target makes `kill` return non-zero without preventing later
	/// process operands from receiving the selected signal.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn kill_builtin_continues_after_target_failure() {
		let mut first = Command::new("sleep")
			.arg("30")
			.spawn()
			.expect("first sleep");
		let mut second = Command::new("sleep")
			.arg("30")
			.spawn()
			.expect("second sleep");
		let mut stale = Command::new("true").spawn().expect("stale process");
		let first_pid = first.id().expect("first pid");
		let second_pid = second.id().expect("second pid");
		let stale_pid = stale.id().expect("stale pid");
		stale.wait().await.expect("stale wait");

		let (mut session, params) = kill_test_context().await;
		let source_info = SourceInfo::from("tau-natives:test");
		let result = session
			.shell
			.run_string(
				format!("kill -KILL {first_pid} {stale_pid} {second_pid}"),
				&source_info,
				&params,
			)
			.await
			.expect("kill command");
		let code = exit_code(&result);

		let statuses =
			time::timeout(Duration::from_secs(5), async { tokio::join!(first.wait(), second.wait()) })
				.await;
		if statuses.is_err() {
			let _ = first.start_kill();
			let _ = second.start_kill();
			let _ = first.wait().await;
			let _ = second.wait().await;
			panic!("kill must continue signaling after an intermediate target fails");
		}
		let (first_status, second_status) = statuses.expect("checked timeout");
		assert_ne!(code, 0, "a failed target should make kill return non-zero");
		assert_eq!(first_status.expect("first wait").signal(), Some(libc::SIGKILL));
		assert_eq!(second_status.expect("second wait").signal(), Some(libc::SIGKILL));
	}
=======
>>>>>>> theirs — scope `/// A failed target makes `kill` return non-z...` deleted in theirs

<<<<<<< ours — scope `/// `cmp` remains available with no executabl...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `cmp` remains available with no executable search path, proving the shell
	/// dispatches the in-process builtin rather than a platform binary.
	#[tokio::test(flavor = "multi_thread")]
	async fn cmp_is_registered_as_an_in_process_builtin() {
		let dir = tempfile::tempdir().expect("temp dir");
		let root = std::fs::canonicalize(dir.path()).expect("canonical temp dir");
		std::fs::write(root.join("a"), b"same").expect("write a");
		std::fs::write(root.join("b"), b"same").expect("write b");
		std::fs::write(root.join("c"), b"different").expect("write c");

		let config = ShellConfig {
			session_env:   Some(hermetic_test_env()),
			snapshot_path: None,
			minimizer:     None,
		};
		let mut session = create_session(&config).await.expect("create_session");
		session
			.shell
			.set_working_dir(root.to_str().expect("utf8 temp path"))
			.expect("set cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null stdout"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null stderr"));
		let source_info = SourceInfo::from("tau-natives:test");

		let equal = session
			.shell
			.run_string("PATH=/definitely-missing cmp -s a b", &source_info, &params)
			.await
			.expect("equal cmp");
		assert_eq!(exit_code(&equal), 0);

		let different = session
			.shell
			.run_string("PATH=/definitely-missing cmp -s a c", &source_info, &params)
			.await
			.expect("different cmp");
		assert_eq!(exit_code(&different), 1);
	}
=======
>>>>>>> theirs — scope `/// `cmp` remains available with no executabl...` deleted in theirs

<<<<<<< ours — scope `/// The moreutils-style builtins (`ts`, `spon...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The moreutils-style builtins (`ts`, `sponge`, `isutf8`, `combine`,
	/// `ifne`, `errno`) dispatch in-process: the script runs with no usable
	/// executable search path, and the `ts | sponge` pipeline must land its
	/// output in the shell's working directory.
	#[tokio::test(flavor = "multi_thread")]
	async fn moreutils_builtins_are_registered_in_process() {
		let dir = tempfile::tempdir().expect("temp dir");
		let root = std::fs::canonicalize(dir.path()).expect("canonical temp dir");

		let config = ShellConfig {
			session_env:   Some(hermetic_test_env()),
			snapshot_path: None,
			minimizer:     None,
		};
		let mut session = create_session(&config).await.expect("create_session");
		session
			.shell
			.set_working_dir(root.to_str().expect("utf8 temp path"))
			.expect("set cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null stdout"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null stderr"));
		let source_info = SourceInfo::from("tau-natives:test");

		let script = "PATH=/definitely-missing\necho x | ts -s '%H:%M:%S' | sponge out || exit \
		              10\nisutf8 out || exit 11\necho x | combine - and out || exit 12\nifne \
		              /definitely-missing/tool || exit 13";
		let result = session
			.shell
			.run_string(script, &source_info, &params)
			.await
			.expect("moreutils script");
		assert_eq!(exit_code(&result), 0);

		// `ts -s` stamps the first line with zero elapsed time: `HH:MM:SS x`.
		let out = std::fs::read_to_string(root.join("out")).expect("sponge output");
		assert!(out.len() == 11 && out.ends_with(" x\n"), "unexpected ts+sponge output: {out:?}");

		#[cfg(unix)]
		{
			let errno = session
				.shell
				.run_string("errno ENOENT", &source_info, &params)
				.await
				.expect("errno lookup");
			assert_eq!(exit_code(&errno), 0);
		}
	}
=======
>>>>>>> theirs — scope `/// The moreutils-style builtins (`ts`, `spon...` deleted in theirs

<<<<<<< ours — scope `/// `sort --compress-program` spawns real chi...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `sort --compress-program` spawns real children from inside the
	/// external-sort temp-file machinery. Those children must inherit the
	/// *shell's* context, not the host process's: the program is resolved
	/// against the shell's exported `PATH` (here a directory that exists only
	/// there), it runs in the shell working directory, and its stderr is
	/// forwarded to the command's own fd 2 instead of being inherited — an
	/// inherited fd 2 belongs to the TUI and would corrupt the rendered frame.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_sort_compress_program_uses_shell_path_and_stderr() {
		use std::os::unix::fs::PermissionsExt as _;

		let tmp = std::env::temp_dir().join(format!("tau-sort-compress-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		let bin = tmp.join("bin");
		std::fs::create_dir_all(&bin).expect("bin dir");

		// An identity "compressor" that also proves it was started with the
		// shell's working directory and reaches the command's stderr.
		let shim = bin.join("tau-test-compress");
		let shell = test_executable("sh");
		let cat = test_executable("cat");
		let shim_source = format!(
			"#!{}\nprintf 'compressor cwd=%s\\n' \"$PWD\" >&2\nexec {}\n",
			shell.display(),
			quote_arg(cat.to_str().expect("utf8 cat path"))
		);
		std::fs::write(&shim, shim_source).expect("write shim");
		std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).expect("chmod shim");

		// Enough distinct lines that the 1K buffer forces spilling through the
		// compressor rather than sorting entirely in memory.
		let mut input = String::new();
		for n in (0..400).rev() {
			use std::fmt::Write as _;
			let _ = writeln!(input, "line{n:04}");
		}
		std::fs::write(tmp.join("in.txt"), &input).expect("write input");

		let config = ShellConfig {
			session_env:   Some(hermetic_test_env()),
			snapshot_path: None,
			minimizer:     None,
		};
		let mut session = create_session(&config).await.expect("create_session");
		session
			.shell
			.set_working_dir(tmp.to_str().expect("utf8 temp path"))
			.expect("set cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null stdout"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null stderr"));
		let source_info = SourceInfo::from("tau-natives:test");

		// `PATH` holds only the shim directory, so the compressor is reachable
		// solely through the shell's exported environment.
		let script = format!(
			"export PATH={}\nsort -S 1K --compress-program=tau-test-compress in.txt > out.txt 2> \
			 err.txt",
			bin.to_str().expect("utf8 bin path")
		);
		let exec = session
			.shell
			.run_string(script, &source_info, &params)
			.await
			.expect("run sort");
		assert_eq!(exit_code(&exec), 0, "sort --compress-program failed");

		let out = std::fs::read_to_string(tmp.join("out.txt")).expect("out.txt");
		let mut expected: Vec<&str> = input.lines().collect();
		expected.sort_unstable();
		assert_eq!(out.lines().collect::<Vec<_>>(), expected, "compressed external sort misordered");

		// The compressor really ran (so the spill path was exercised), its
		// stderr reached the command's redirected fd 2, and it started in the
		// shell working directory.
		let err = std::fs::read_to_string(tmp.join("err.txt")).expect("err.txt");
		assert!(
			err.contains("compressor cwd="),
			"compressor stderr never reached the command's fd 2: {err:?}"
		);
		// The shell reports the working directory as it was set; macOS also
		// exposes it under `/private`, so accept either spelling.
		let canonical = std::fs::canonicalize(&tmp).expect("canonical tmp");
		assert!(
			err.contains(&format!("cwd={}\n", tmp.display()))
				|| err.contains(&format!("cwd={}\n", canonical.display())),
			"compressor did not start in the shell working directory ({}): {err:?}",
			tmp.display()
		);

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// `sort --compress-program` spawns real chi...` deleted in theirs

<<<<<<< ours — scope `/// The uutils-backed `mkdir` builtin must (1...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The uutils-backed `mkdir` builtin must (1) create directories under the
	/// shell's working directory rather than the host process cwd, (2) route
	/// `-v` output through the command's (here redirected) stdout, and (3)
	/// display the original operand, not the resolved absolute path.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_mkdir_resolves_cwd_and_displays_operand() {
		let tmp = std::env::temp_dir().join(format!("tau-mkdir-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		let tmp_str = tmp.to_str().expect("utf8 temp path");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("set cwd");

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));

		let source_info = SourceInfo::from("tau-natives:test");
		let exec = session
			.shell
			.run_string("mkdir -v -p a/b/c rel > out.txt", &source_info, &params)
			.await
			.expect("run_string");
		assert!(matches!(exec.exit_code, ExecutionExitCode::Success), "exit {}", exit_code(&exec));

		// (1) created under the shell working dir, and (2) not leaked into the
		// host process cwd.
		assert!(tmp.join("a/b/c").is_dir(), "nested dirs not created under shell cwd");
		assert!(tmp.join("rel").is_dir(), "rel not created under shell cwd");
		assert!(!std::path::Path::new("a/b/c").exists(), "mkdir leaked into process cwd");

		// (2)+(3): -v output reached the redirected file, names the operand, and
		// does not leak the absolute resolved path.
		let out = std::fs::read_to_string(tmp.join("out.txt")).expect("out.txt");
		assert!(out.contains("'rel'"), "verbose output missing operand `rel`: {out:?}");
		assert!(!out.contains(tmp_str), "verbose output leaked absolute path: {out:?}");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// The uutils-backed `mkdir` builtin must (1...` deleted in theirs

<<<<<<< ours — scope `/// `command -v`/`-V` must iterate over every...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `command -v`/`-V` must iterate over every operand like bash/zsh, printing
	/// one line per name that resolves and skipping the misses, rather than
	/// honoring only the first operand. Regression test for silently dropped
	/// operands in `command -v a b c` (issue #10544).
	#[tokio::test(flavor = "multi_thread")]
	async fn command_v_iterates_all_operands() {
		let tmp = std::env::temp_dir().join(format!("tau-command-v-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		let tmp_str = tmp.to_str().expect("utf8 temp path");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("set cwd");

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));

		let source_info = SourceInfo::from("tau-natives:test");

		// Three always-registered builtins plus a name that never resolves. bash
		// prints one line per resolved builtin and skips the miss, exiting 0.
		let exec = session
			.shell
			.run_string("command -v true false pwd nope-xyz-10544 > out.txt", &source_info, &params)
			.await
			.expect("run_string");
		assert_eq!(exit_code(&exec), 0, "command -v exit code with a resolvable name");

		let out = std::fs::read_to_string(tmp.join("out.txt")).expect("out.txt");
		let lines: Vec<&str> = out.lines().collect();
		assert_eq!(
			lines,
			vec!["true", "false", "pwd"],
			"command -v must print one line per resolved operand and skip misses: {out:?}"
		);

		// When no operand resolves, the exit status is a general error.
		let exec = session
			.shell
			.run_string("command -v nope-a-10544 nope-b-10544", &source_info, &params)
			.await
			.expect("run_string");
		assert_eq!(exit_code(&exec), 1, "command -v exit code when nothing resolves");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// `command -v`/`-V` must iterate over every...` deleted in theirs

<<<<<<< ours — scope `/// Every utility `pi-builtins` offers must a...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Every utility `tau-builtins` offers must actually be dispatchable in
	/// process, under the name it is registered as.
	///
	/// The registry (`tau_builtins::utility_builtins`) maps a name to a
	/// `Registration`, and each registration renders its help from its own
	/// `clap` command. Wiring a name to the wrong module — easy to do, since the
	/// mapping is written by hand — still compiles and still runs; the only
	/// visible symptom is that `NAME --help` describes some other utility. With
	/// `PATH` emptied there is no binary to fall back on, so this also proves
	/// the whole set resolves as builtins rather than as system commands.
	#[tokio::test(flavor = "multi_thread")]
	async fn every_utility_builtin_is_registered_under_its_own_name() {
		let tmp = std::env::temp_dir().join(format!("tau-utility-help-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");

		let config = ShellConfig {
			session_env:   Some(hermetic_test_env()),
			snapshot_path: None,
			minimizer:     None,
		};
		let mut session = create_session(&config).await.expect("create_session");
		session
			.shell
			.set_working_dir(tmp.to_str().expect("utf8 temp path"))
			.expect("set cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null stdout"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null stderr"));
		let source_info = SourceInfo::from("tau-natives:test");

		// Pin the registry contents rather than iterating whatever it happens to
		// contain: a loop over the registry cannot notice a name missing from it.
		// Adding a utility is expected to update this list.
		let expected = [
			"b2sum",
			"base32",
			"base64",
			"basename",
			"cat",
			"cksum",
			"cmp",
			"combine",
			"comm",
			"cut",
			"date",
			"diff",
			"dirname",
			"errno",
			"fd",
			"find",
			"grep",
			"head",
			"hostname",
			"ifne",
			"isutf8",
			"jq",
			"ln",
			"ls",
			"md5sum",
			"mkdir",
			"mktemp",
			"mv",
			"nproc",
			"paste",
			"printenv",
			"readlink",
			"realpath",
			"rg",
			"rm",
			"sed",
			"seq",
			"sha1sum",
			"sha224sum",
			"sha256sum",
			"sha384sum",
			"sha512sum",
			"sort",
			"sponge",
			"stat",
			"tac",
			"tail",
			"tee",
			"touch",
			"tr",
			"truncate",
			"ts",
			"uname",
			"uniq",
			"wc",
			"which",
			"whoami",
			"xargs",
			"yes",
		];
		let mut names: Vec<&'static str> =
			tau_builtins::utility_builtins::<brush_core::extensions::DefaultShellExtensions>()
				.into_iter()
				.map(|(name, _)| name)
				.collect();
		names.sort_unstable();
		assert_eq!(names, expected, "the utility builtin registry changed");

		for name in names {
			let exec = session
				.shell
				.run_string(format!("PATH= {name} --help > help.txt 2> err.txt"), &source_info, &params)
				.await
				.unwrap_or_else(|err| panic!("{name} --help failed to run: {err}"));
			assert_eq!(exit_code(&exec), 0, "{name} --help exited nonzero");

			let help = std::fs::read_to_string(tmp.join("help.txt")).expect("help.txt");
			let err = std::fs::read_to_string(tmp.join("err.txt")).expect("err.txt");
			assert!(err.is_empty(), "{name} --help wrote to stderr: {err:?}");
			// Two builtins are registered under the familiar command name but keep
			// their implementation's own help text, exactly as the standalone
			// versions did: `rg` is ripgrep, `jq` is jaq.
			let expected = match name {
				"rg" => "ripgrep",
				"jq" => "jaq",
				other => other,
			};
			assert!(
				help.contains(expected),
				"{name} --help does not mention {expected:?}, so it is wired to the wrong utility: \
				 {help:.200?}"
			);
		}

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// Every utility `pi-builtins` offers must a...` deleted in theirs

<<<<<<< ours — scope `/// Every process builtin `pi-builtins` offer...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Every process builtin `tau-builtins` offers must be installed and
	/// dispatch in process.
	///
	/// `factory.rs` maps each name to a struct by hand, so a mis-wire compiles
	/// and runs — and with `PATH` emptied there is no binary to silently fall
	/// back to, which is the failure this catches. Each command gets an
	/// invocation that is benign but must reach the builtin: exit 127 means the
	/// name never resolved.
	#[tokio::test(flavor = "multi_thread")]
	async fn every_process_builtin_is_installed_and_dispatches() {
		let tmp = std::env::temp_dir().join(format!("tau-process-builtins-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session
			.shell
			.set_working_dir(tmp.to_str().expect("utf8 temp path"))
			.expect("set cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null stdout"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null stderr"));
		let source_info = SourceInfo::from("tau-natives:test");

		// Bounded, side-effect-free invocations. `pgrep`/`pkill`/`pidwait` render
		// their own help; `sleep`/`timeout`/`top` are given the smallest amount
		// of work that still exercises dispatch; `nohup` with no operand is a
		// usage error, which is still the builtin answering.
		let probes = [
			("nohup", "nohup"),
			("pgrep", "pgrep --help"),
			("pidwait", "pidwait --help"),
			("pkill", "pkill --help"),
			("ps", "ps --help"),
			("sleep", "sleep 0"),
			("timeout", "timeout 1 true"),
			("top", "top -n 0"),
		];

		// Pin the registry contents rather than deriving the probe list from it:
		// a test that skips whatever the registry omits cannot notice an
		// omission.
		let mut registered: Vec<&'static str> =
			tau_builtins::process_builtins::<brush_core::extensions::DefaultShellExtensions>()
				.into_iter()
				.map(|(name, _)| name)
				.collect();
		registered.sort_unstable();
		let expected: Vec<&'static str> = probes.iter().map(|(name, _)| *name).collect();
		assert_eq!(registered, expected, "the process builtin registry changed");

		// `kill` comes from the default builtin set, where our implementation
		// replaced brush's, so it is checked alongside but not listed above.
		for (name, command) in probes.iter().copied().chain([("kill", "kill -l")]) {
			let exec = session
				.shell
				.run_string(format!("PATH= {command}"), &source_info, &params)
				.await
				.unwrap_or_else(|err| panic!("{name} failed to run: {err}"));
			assert_ne!(
				exit_code(&exec),
				127,
				"{name} resolved to nothing: it is not registered as a builtin"
			);
		}

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// Every process builtin `pi-builtins` offer...` deleted in theirs

<<<<<<< ours — scope `/// Regression test for issue #5819: `mkdir -...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Regression test for issue #5819: `mkdir -p ~/proj/{a,b}` must create both
	/// `a` and `b` under `$HOME/proj`. Brace expansion runs before tilde
	/// expansion and previously left every element after the first with a
	/// literal `~`, so `b` was created as `./~/proj/b` in the shell cwd instead.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_mkdir_expands_tilde_for_every_brace_element() {
		let base = std::env::temp_dir().join(format!("tau-mkdir-brace-{}", std::process::id()));
		let home = base.join("home");
		let cwd = base.join("cwd");
		let _ = std::fs::remove_dir_all(&base);
		std::fs::create_dir_all(&home).expect("home dir");
		std::fs::create_dir_all(&cwd).expect("cwd dir");
		let cwd_str = cwd.to_str().expect("utf8 cwd path");

		let mut env = HashMap::new();
		env.insert("HOME".to_string(), home.to_string_lossy().to_string());
		let config =
			ShellConfig { session_env: Some(env), snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(cwd_str).expect("set cwd");

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));

		let source_info = SourceInfo::from("tau-natives:test");
		let exec = session
			.shell
			.run_string("mkdir -p ~/proj/{a,b}", &source_info, &params)
			.await
			.expect("run_string");
		assert!(matches!(exec.exit_code, ExecutionExitCode::Success), "exit {}", exit_code(&exec));

		// Both elements' tildes expanded: dirs land under $HOME/proj.
		assert!(home.join("proj/a").is_dir(), "~/proj/a not created under HOME");
		assert!(home.join("proj/b").is_dir(), "~/proj/b not created under HOME");
		// The buggy path created a literal `~` tree in the shell cwd.
		assert!(!cwd.join("~").exists(), "literal ~ tree leaked into cwd");
		assert!(!cwd.join("a").exists(), "unexpanded element leaked into cwd");

		let _ = std::fs::remove_dir_all(&base);
	}
=======
>>>>>>> theirs — scope `/// Regression test for issue #5819: `mkdir -...` deleted in theirs

<<<<<<< ours — scope `/// `mkdir --help` and an invalid flag must b...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `mkdir --help` and an invalid flag must be handled in-process: rendered
	/// to the command streams and returned as an exit code. The upstream
	/// `uumain` parser calls `std::process::exit`, which would terminate the
	/// whole host (and this test binary); reaching the asserts proves the
	/// vendored `run` entry point bypasses that path.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_mkdir_help_and_bad_flag_do_not_exit_process() {
		let tmp = std::env::temp_dir().join(format!("tau-mkdir-help-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		let tmp_str = tmp.to_str().expect("utf8 temp path");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("set cwd");

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let source_info = SourceInfo::from("tau-natives:test");

		let help = session
			.shell
			.run_string("mkdir --help > help.txt", &source_info, &params)
			.await
			.expect("run_string help");
		assert_eq!(exit_code(&help), 0, "mkdir --help should succeed");
		let help_text = std::fs::read_to_string(tmp.join("help.txt")).expect("help.txt");
		assert!(help_text.contains("mkdir"), "help text missing util name: {help_text:?}");

		let bad = session
			.shell
			.run_string("mkdir --no-such-flag 2> err.txt", &source_info, &params)
			.await
			.expect("run_string bad flag");
		assert_ne!(exit_code(&bad), 0, "invalid flag should be a usage error");
		let err_text = std::fs::read_to_string(tmp.join("err.txt")).expect("err.txt");
		assert!(!err_text.is_empty(), "usage error should be reported to stderr");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// `mkdir --help` and an invalid flag must b...` deleted in theirs

<<<<<<< ours — scope `/// The uutils-backed `head` builtin must rea...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The uutils-backed `head` builtin must read piped stdin through the
	/// context, read file operands resolved against the shell working directory,
	/// honor the obsolete `-NUM` syntax, and write to the command's (here
	/// redirected) stdout.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_head_streams_stdin_and_reads_files() {
		let tmp = std::env::temp_dir().join(format!("tau-head-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		std::fs::write(tmp.join("data.txt"), "l1\nl2\nl3\nl4\nl5\n").expect("write data");
		let tmp_str = tmp.to_str().expect("utf8 temp path");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("set cwd");

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let source_info = SourceInfo::from("tau-natives:test");

		// File operand, resolved against the shell working directory.
		let f = session
			.shell
			.run_string("head -2 data.txt > out_file.txt", &source_info, &params)
			.await
			.expect("run_string file");
		assert_eq!(exit_code(&f), 0, "head file read should succeed");
		assert_eq!(std::fs::read_to_string(tmp.join("out_file.txt")).unwrap(), "l1\nl2\n");

		// Piped stdin (head is the final stage; reads the pipe through the ctx).
		let p = session
			.shell
			.run_string("printf 'a\\nb\\nc\\nd\\n' | head -2 > out_pipe.txt", &source_info, &params)
			.await
			.expect("run_string pipe");
		assert_eq!(exit_code(&p), 0, "head stdin read should succeed");
		assert_eq!(std::fs::read_to_string(tmp.join("out_pipe.txt")).unwrap(), "a\nb\n");

		// Obsolete `-NUM` syntax, normalized by arg_iterate.
		let o = session
			.shell
			.run_string("printf '1\\n2\\n3\\n' | head -1 > out_obs.txt", &source_info, &params)
			.await
			.expect("run_string obsolete");
		assert_eq!(exit_code(&o), 0, "head -1 should succeed");
		assert_eq!(std::fs::read_to_string(tmp.join("out_obs.txt")).unwrap(), "1\n");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// The uutils-backed `head` builtin must rea...` deleted in theirs

<<<<<<< ours — scope `/// `head --help` / invalid flag must be hand...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `head --help` / invalid flag must be handled in-process (rendered to the
	/// command streams, returned as an exit code) — head has its own `run`
	/// entry point bypassing uutils' process-exiting parser, and literalized
	/// help strings.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_head_help_and_bad_flag_do_not_exit_process() {
		let tmp = std::env::temp_dir().join(format!("tau-head-help-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		let tmp_str = tmp.to_str().expect("utf8 temp path");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("set cwd");

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let source_info = SourceInfo::from("tau-natives:test");

		let help = session
			.shell
			.run_string("head --help > help.txt", &source_info, &params)
			.await
			.expect("run_string head help");
		assert_eq!(exit_code(&help), 0, "head --help should succeed");
		let help_text = std::fs::read_to_string(tmp.join("help.txt")).expect("help.txt");
		assert!(help_text.contains("first"), "help text not localized: {help_text:?}");

		let bad = session
			.shell
			.run_string("head --no-such-flag 2> err.txt", &source_info, &params)
			.await
			.expect("run_string head bad flag");
		assert_ne!(exit_code(&bad), 0, "invalid flag should be a usage error");
		assert_ne!(std::fs::read_to_string(tmp.join("err.txt")).expect("err.txt"), "");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// `head --help` / invalid flag must be hand...` deleted in theirs

<<<<<<< ours — scope `/// Smoke-test the read-only uutils filter/li...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Smoke-test the read-only uutils filter/listing builtins end-to-end
	/// through the shell: piped stdin (sort/wc/tail), file reads + cwd
	/// resolution (grep/ls/find), and redirected stdout capture.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_filters_listing_find_grep() {
		let tmp = std::env::temp_dir().join(format!("tau-utils-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(tmp.join("sub")).expect("temp dirs");
		std::fs::write(tmp.join("data.txt"), "foo\nbar\nbaz\n").expect("data");
		std::fs::write(tmp.join("sub/nested.txt"), "deep\n").expect("nested");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		// sort: reads piped stdin, parallel sort, writes sorted output.
		session
			.shell
			.run_string("printf 'c\\na\\nb\\n' | sort > sort.txt", &si, &params)
			.await
			.expect("sort");
		assert_eq!(read("sort.txt"), "a\nb\nc\n");
		// wc -l: line count from stdin.
		session
			.shell
			.run_string("printf 'x\\ny\\nz\\n' | wc -l > wc.txt", &si, &params)
			.await
			.expect("wc");
		assert_eq!(read("wc.txt").trim(), "3");
		// tail: last N lines from stdin.
		session
			.shell
			.run_string("printf '1\\n2\\n3\\n4\\n' | tail -2 > tail.txt", &si, &params)
			.await
			.expect("tail");
		assert_eq!(read("tail.txt"), "3\n4\n");
		// grep: matching lines from a cwd-resolved file (single file => no
		// prefix).
		session
			.shell
			.run_string("grep ba data.txt > grep.txt", &si, &params)
			.await
			.expect("grep");
		assert_eq!(read("grep.txt"), "bar\nbaz\n");
		// ls: non-tty listing of the cwd.
		session
			.shell
			.run_string("ls > ls.txt", &si, &params)
			.await
			.expect("ls");
		let ls = read("ls.txt");
		assert!(ls.contains("data.txt") && ls.contains("sub"), "ls output: {ls:?}");
		// find: recursive name match. Paths must keep the `.` operand prefix
		// (GNU/BSD contract) instead of leaking the working-dir-resolved absolute
		// root the walk is physically rooted at.
		session
			.shell
			.run_string("find . -name '*.txt' > find.txt", &si, &params)
			.await
			.expect("find");
		let found = read("find.txt");
		assert!(!found.trim().is_empty(), "find produced no output");
		for line in found.lines() {
			assert!(
				line.starts_with("./"),
				"find path is not operand-relative: {line:?} (full: {found:?})"
			);
		}
		assert!(
			found.contains("./data.txt") && found.contains("./sub/nested.txt"),
			"find output: {found:?}"
		);
		// cat: concatenate a cwd-resolved file with -n line numbering.
		session
			.shell
			.run_string("cat -n data.txt > cat.txt", &si, &params)
			.await
			.expect("cat");
		assert_eq!(read("cat.txt"), "     1\tfoo\n     2\tbar\n     3\tbaz\n");
		// uniq: collapse adjacent duplicate lines from piped stdin.
		session
			.shell
			.run_string("printf 'a\\na\\nb\\nb\\nb\\nc\\n' | uniq > uniq.txt", &si, &params)
			.await
			.expect("uniq");
		assert_eq!(read("uniq.txt"), "a\nb\nc\n");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// Smoke-test the read-only uutils filter/li...` deleted in theirs

<<<<<<< ours — scope `/// `rg` is not an alias for `grep`: it recur...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `rg` is not an alias for `grep`: it recurses by default, respects
	/// ripgrep's ignore/hidden/binary filters, and keeps `-h` as help.
	#[tokio::test(flavor = "multi_thread")]
	async fn rg_builtin_uses_ripgrep_defaults() {
		let tmp = std::env::temp_dir().join(format!("tau-rg-defaults-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(tmp.join("sub")).expect("sub dir");
		std::fs::create_dir_all(tmp.join(".git")).expect("git dir");
		std::fs::write(tmp.join("data.txt"), "alpha\nneedle\n").expect("data");
		std::fs::write(tmp.join("sub/nested.txt"), "needle\n").expect("nested");
		std::fs::write(tmp.join(".hidden.txt"), "needle\n").expect("hidden");
		std::fs::write(tmp.join("ignored.log"), "needle\n").expect("ignored");
		std::fs::write(tmp.join(".gitignore"), "ignored.log\n").expect("gitignore");
		std::fs::write(tmp.join("binary.bin"), b"needle\0hidden\n").expect("binary");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig {
			session_env:   Some(hermetic_test_env()),
			snapshot_path: None,
			minimizer:     None,
		};
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		let exec = session
			.shell
			.run_string("rg needle > rg.txt", &si, &params)
			.await
			.expect("rg");
		assert_eq!(exit_code(&exec), 0, "rg recursive search should match");
		let out = read("rg.txt");
		assert!(out.contains("data.txt:needle"), "rg missed visible file: {out:?}");
		assert!(out.contains("sub/nested.txt:needle"), "rg missed nested file: {out:?}");
		assert!(!out.contains(".hidden.txt"), "rg searched hidden file by default: {out:?}");
		assert!(!out.contains("ignored.log"), "rg ignored .gitignore by default: {out:?}");
		assert!(!out.contains("binary.bin"), "rg printed binary file by default: {out:?}");

		let single = session
			.shell
			.run_string("rg -nH needle data.txt > single.txt", &si, &params)
			.await
			.expect("rg single");
		assert_eq!(exit_code(&single), 0, "rg explicit file should match");
		assert_eq!(read("single.txt"), "data.txt:2:needle\n");

		let explicit_binary = session
			.shell
			.run_string("rg needle binary.bin > explicit-binary.txt", &si, &params)
			.await
			.expect("rg explicit binary");
		assert_eq!(exit_code(&explicit_binary), 0, "explicit binary file should be searched");
		assert_eq!(read("explicit-binary.txt"), "needle\n");

		let help = session
			.shell
			.run_string("rg -h > help.txt", &si, &params)
			.await
			.expect("rg help");
		assert_eq!(exit_code(&help), 0, "rg -h should be help, not no-filename");
		assert!(
			read("help.txt").contains("ripgrep recursively searches"),
			"help text should describe ripgrep"
		);

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// `rg` is not an alias for `grep`: it recur...` deleted in theirs

<<<<<<< ours — scope `/// `fd` recurses from the shell working dire...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `fd` recurses from the shell working directory, respects hidden and
	/// ignore filters (including `.fdignore`), preserves explicit search-path
	/// prefixes, and renders help to stdout with a success status.
	#[tokio::test(flavor = "multi_thread")]
	async fn fd_builtin_uses_fd_defaults() {
		let tmp = std::env::temp_dir().join(format!("tau-fd-defaults-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(tmp.join("sub")).expect("sub dir");
		std::fs::create_dir_all(tmp.join(".git/info")).expect("git info dir");
		std::fs::write(tmp.join("needle.txt"), "visible\n").expect("visible");
		std::fs::write(tmp.join("sub/needle.rs"), "nested\n").expect("nested");
		std::fs::write(tmp.join(".hidden-needle.txt"), "hidden\n").expect("hidden");
		std::fs::write(tmp.join("ignored-needle.log"), "ignored\n").expect("ignored");
		std::fs::write(tmp.join("excluded-needle.vcs"), "excluded\n").expect("excluded");
		std::fs::write(tmp.join("fdignored-needle.tmp"), "fdignored\n").expect("fdignored");
		std::fs::write(tmp.join(".gitignore"), "ignored-needle.log\n").expect("gitignore");
		std::fs::write(tmp.join(".git/info/exclude"), "excluded-needle.vcs\n").expect("exclude");
		std::fs::write(tmp.join(".fdignore"), "fdignored-needle.tmp\n").expect("fdignore");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		let exec = session
			.shell
			.run_string("fd needle > fd.txt", &si, &params)
			.await
			.expect("fd");
		assert_eq!(exit_code(&exec), 0, "fd should match visible files");
		let out = read("fd.txt");
		assert!(out.contains("needle.txt"), "fd missed visible file: {out:?}");
		assert!(out.contains("sub/needle.rs"), "fd missed nested file: {out:?}");
		assert!(!out.contains(".hidden-needle.txt"), "fd searched hidden file: {out:?}");
		assert!(!out.contains("ignored-needle.log"), "fd ignored .gitignore: {out:?}");
		assert!(!out.contains("fdignored-needle.tmp"), "fd ignored .fdignore: {out:?}");
		assert!(!out.contains("excluded-needle.vcs"), "fd ignored .git/info/exclude: {out:?}");

		session
			.shell
			.run_string("fd -u needle > unrestricted.txt", &si, &params)
			.await
			.expect("fd -u");
		let unrestricted = read("unrestricted.txt");
		assert!(unrestricted.contains(".hidden-needle.txt"), "-u should include hidden files");
		assert!(unrestricted.contains("ignored-needle.log"), "-u should include gitignored files");
		assert!(unrestricted.contains("fdignored-needle.tmp"), "-u should include fdignored files");

		session
			.shell
			.run_string("fd --no-ignore-vcs needle > no-ignore-vcs.txt", &si, &params)
			.await
			.expect("fd --no-ignore-vcs");
		let no_ignore_vcs = read("no-ignore-vcs.txt");
		assert!(
			no_ignore_vcs.contains("ignored-needle.log"),
			"--no-ignore-vcs should include .gitignore matches"
		);
		assert!(
			no_ignore_vcs.contains("excluded-needle.vcs"),
			"--no-ignore-vcs should include .git/info/exclude matches"
		);
		assert!(
			!no_ignore_vcs.contains("fdignored-needle.tmp"),
			"--no-ignore-vcs must still respect .fdignore"
		);

		session
			.shell
			.run_string("fd --glob '*.rs' sub > glob.txt", &si, &params)
			.await
			.expect("fd glob");
		assert_eq!(read("glob.txt"), "sub/needle.rs\n");

		let no_match = session
			.shell
			.run_string("fd definitely-absent > no-match.txt", &si, &params)
			.await
			.expect("fd no match");
		assert_eq!(exit_code(&no_match), 0, "ordinary fd no-match should still succeed");
		assert_eq!(read("no-match.txt"), "");

		let quiet_miss = session
			.shell
			.run_string("fd -q definitely-absent > quiet-miss.txt", &si, &params)
			.await
			.expect("fd quiet miss");
		assert_eq!(exit_code(&quiet_miss), 1, "quiet fd no-match should fail");
		assert_eq!(read("quiet-miss.txt"), "");

		let quiet_hit = session
			.shell
			.run_string("fd -q needle > quiet-hit.txt", &si, &params)
			.await
			.expect("fd quiet hit");
		assert_eq!(exit_code(&quiet_hit), 0, "quiet fd match should succeed");
		assert_eq!(read("quiet-hit.txt"), "");

		let help = session
			.shell
			.run_string("fd --help > help.txt 2> help.err", &si, &params)
			.await
			.expect("fd help");
		assert_eq!(exit_code(&help), 0, "fd help should succeed");
		assert!(read("help.txt").contains("A program to find entries in your filesystem"));
		assert_eq!(read("help.err"), "");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// `fd` recurses from the shell working dire...` deleted in theirs

<<<<<<< ours — scope `/// Plain `rg PATTERN` uses the shell working...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Plain `rg PATTERN` uses the shell working directory when the host wired
	/// stdin to null, but a real pipeline remains stdin input. Pattern stdin
	/// (`-f -`) must not consume the implicit search path decision.
	#[tokio::test(flavor = "multi_thread")]
	async fn rg_builtin_defaults_to_cwd_unless_stdin_is_pipeline() {
		let tmp = std::env::temp_dir().join(format!("tau-rg-stdin-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		std::fs::write(tmp.join("data.txt"), "from-cwd\nfrom-pattern\n").expect("data");
		std::fs::write(tmp.join("z-output.txt"), "from-cwd\n").expect("output seed");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		session
			.shell
			.run_string("rg --sort path --max-count 1 from-cwd >> z-output.txt", &si, &params)
			.await
			.expect("rg cwd");
		assert_eq!(read("z-output.txt"), "from-cwd\ndata.txt:from-cwd\n");

		session
			.shell
			.run_string("printf 'from-pipe\\n' | rg from-pipe > pipe.txt", &si, &params)
			.await
			.expect("rg pipe");
		assert_eq!(read("pipe.txt"), "from-pipe\n");

		session
			.shell
			.run_string("printf 'from-pattern\\n' | rg -f - > pattern.txt", &si, &params)
			.await
			.expect("rg pattern stdin");
		assert_eq!(read("pattern.txt"), "data.txt:from-pattern\n");

		session
			.shell
			.run_string("printf 'not-a-path\\n' | rg --files > files.txt", &si, &params)
			.await
			.expect("rg files");
		let files = read("files.txt");
		assert!(files.contains("data.txt"), "--files should list cwd files: {files:?}");
		assert!(!files.contains("not-a-path"), "--files must not read piped stdin: {files:?}");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// Plain `rg PATTERN` uses the shell working...` deleted in theirs

<<<<<<< ours — scope `/// `grep -q` must suppress all stdout and dr...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// `grep -q` must suppress all stdout and drive the exit status (0 on match,
	/// 1 otherwise) so shell conditionals work; `-x` must anchor whole lines.
	/// Mirrors busybox applet probing: `grep -qx "$applet" <(strings bin)`.
	#[tokio::test(flavor = "multi_thread")]
	async fn grep_quiet_and_line_regexp() {
		let tmp = std::env::temp_dir().join(format!("tau-grepq-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		std::fs::write(tmp.join("data.txt"), "foo\nbar\nbaz\n").expect("data");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		// -q: no stdout even on a match.
		session
			.shell
			.run_string("grep -q ba data.txt > qout.txt", &si, &params)
			.await
			.expect("grep -q");
		assert_eq!(read("qout.txt"), "", "-q must not print matches");
		// -q exit code drives `&&` (match) and `||` (no match).
		session
			.shell
			.run_string("grep -q ba data.txt && echo HIT > hit.txt", &si, &params)
			.await
			.expect("grep -q hit");
		assert_eq!(read("hit.txt"), "HIT\n", "-q match must exit 0");
		session
			.shell
			.run_string("grep -q zzz data.txt || echo MISS > miss.txt", &si, &params)
			.await
			.expect("grep -q miss");
		assert_eq!(read("miss.txt"), "MISS\n", "-q no-match must exit 1");
		// -qx: whole-line match succeeds on an exact line ...
		session
			.shell
			.run_string("grep -qx bar data.txt && echo XHIT > xhit.txt", &si, &params)
			.await
			.expect("grep -qx hit");
		assert_eq!(read("xhit.txt"), "XHIT\n", "-x must match a whole line");
		// ... and fails on a substring that is not a whole line.
		session
			.shell
			.run_string("grep -qx ba data.txt || echo XMISS > xmiss.txt", &si, &params)
			.await
			.expect("grep -qx miss");
		assert_eq!(read("xmiss.txt"), "XMISS\n", "-x must reject a partial-line match");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// `grep -q` must suppress all stdout and dr...` deleted in theirs

<<<<<<< ours — scope `/// The destructive uutils builtins (`rm`, `m...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The destructive uutils builtins (`rm`, `mv`) must operate on paths
	/// resolved against the shell working directory, not the host process cwd.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_rm_and_mv_operate_on_shell_cwd() {
		let tmp = std::env::temp_dir().join(format!("tau-rmmv-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(tmp.join("tree/inner")).expect("tree");
		std::fs::write(tmp.join("a.txt"), "hello").expect("a");
		std::fs::write(tmp.join("tree/inner/leaf.txt"), "x").expect("leaf");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");

		// mv: rename within the shell cwd.
		let mv = session
			.shell
			.run_string("mv a.txt b.txt", &si, &params)
			.await
			.expect("mv");
		assert_eq!(exit_code(&mv), 0, "mv should succeed");
		assert!(!tmp.join("a.txt").exists(), "source should be gone");
		assert_eq!(std::fs::read_to_string(tmp.join("b.txt")).unwrap(), "hello");

		// rm -rf: recursive removal resolved against the shell cwd.
		let rm = session
			.shell
			.run_string("rm -rf tree", &si, &params)
			.await
			.expect("rm");
		assert_eq!(exit_code(&rm), 0, "rm -rf should succeed");
		assert!(!tmp.join("tree").exists(), "tree should be removed");
		// and the host process cwd must be untouched.
		assert!(tmp.join("b.txt").exists());

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// The destructive uutils builtins (`rm`, `m...` deleted in theirs

<<<<<<< ours — scope `/// Removing a nonexistent file must print ex...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Removing a nonexistent file must print exactly one diagnostic (like GNU
	/// rm) and exit non-zero — not a second, message-less `rm:` line. Regression
	/// guard: the in-process entry point used to re-print the status-only
	/// `Err(1)` returned after `remove()` had already reported each failure.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_rm_missing_file_prints_single_diagnostic() {
		let tmp = std::env::temp_dir().join(format!("tau-rm-missing-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");

		let rm = session
			.shell
			.run_string("rm nonexistent.txt 2> err.txt", &si, &params)
			.await
			.expect("rm");
		assert_ne!(exit_code(&rm), 0, "rm of a missing file must report failure");
		let err = std::fs::read_to_string(tmp.join("err.txt")).expect("err.txt");
		let lines: Vec<&str> = err.lines().collect();
		assert_eq!(lines.len(), 1, "rm should emit exactly one diagnostic line, got: {err:?}");
		assert!(lines[0].contains("nonexistent.txt"), "diagnostic should name the file: {err:?}");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// Removing a nonexistent file must print ex...` deleted in theirs

<<<<<<< ours — scope `/// The find display/match surface must use t...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The find display/match surface must use the operand-relative path while
	/// filesystem actions still target the real (resolved) path: `-path` and
	/// `-printf %p` see `./...`, while `-delete` removes the correct file.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_find_display_and_actions_split_paths() {
		let tmp = std::env::temp_dir().join(format!("tau-find-split-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(tmp.join("sub")).expect("dirs");
		std::fs::write(tmp.join("keep.log"), "k").expect("keep");
		std::fs::write(tmp.join("sub/drop.tmp"), "d").expect("drop");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		// -path matches against the operand-relative path.
		session
			.shell
			.run_string("find . -path './sub/*' > p.txt", &si, &params)
			.await
			.expect("path");
		assert_eq!(read("p.txt"), "./sub/drop.tmp\n", "-path should match the operand-relative path");

		// -printf %p emits the operand-relative path.
		session
			.shell
			.run_string("find . -name keep.log -printf '%p\\n' > pf.txt", &si, &params)
			.await
			.expect("printf");
		assert_eq!(read("pf.txt"), "./keep.log\n", "-printf %p should be operand-relative");

		// -delete operates on the real (resolved) path, removing the right file.
		let del = session
			.shell
			.run_string("find . -name '*.tmp' -delete", &si, &params)
			.await
			.expect("delete");
		assert_eq!(exit_code(&del), 0, "find -delete should succeed");
		assert!(!tmp.join("sub/drop.tmp").exists(), "-delete should remove the matched file");
		assert!(tmp.join("keep.log").exists(), "-delete must not touch unmatched files");

		// -exec substitutes the operand-relative path and runs in the shell cwd,
		// so the relative `{}` resolves and the child's redirect lands in the
		// cwd.
		session
			.shell
			.run_string(
				"find . -name keep.log -exec sh -c 'printf %s \"$1\" > ex.txt' sh {} ';'",
				&si,
				&params,
			)
			.await
			.expect("exec");
		assert_eq!(
			read("ex.txt"),
			"./keep.log",
			"-exec {{}} should be operand-relative and run in the shell cwd"
		);

		// -exec children must write through the scope streams — an inherited
		// process stdout would bypass the shell redirect and spam the host
		// TUI's terminal — and must see the shell's exported environment.
		session
			.shell
			.run_string(
				"export PI_EXEC_ENV=zed; find . -name keep.log -exec sh -c 'echo \"$PI_EXEC_ENV $1\"' \
				 sh {} ';' > cap.txt",
				&si,
				&params,
			)
			.await
			.expect("exec capture");
		assert_eq!(
			read("cap.txt"),
			"zed ./keep.log\n",
			"-exec child stdout must flow through the shell redirect with the shell's exported env"
		);

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// The find display/match surface must use t...` deleted in theirs

<<<<<<< ours — scope `/// The vendored `sed` builtin must stream pi...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The vendored `sed` builtin must stream pipeline stdin through scripts and
	/// perform `-i` in-place edits (with backup suffix) against the shell
	/// working directory rather than the host process cwd.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_sed_substitutes_streams_and_edits_in_place() {
		let tmp = std::env::temp_dir().join(format!("tau-sed-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		std::fs::write(tmp.join("conf.txt"), "x=1\n").expect("conf");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		// Piped stdin through a quiet substitute-and-print script.
		session
			.shell
			.run_string("printf 'hello\\nworld\\n' | sed -n 's/hello/HI/p' > sed.txt", &si, &params)
			.await
			.expect("sed pipeline");
		assert_eq!(read("sed.txt"), "HI\n");
		// In-place edit of a cwd-relative operand, keeping the requested backup.
		session
			.shell
			.run_string("sed -i.bak 's/1/2/' conf.txt", &si, &params)
			.await
			.expect("sed -i");
		assert_eq!(read("conf.txt"), "x=2\n", "in-place edit must land in the shell cwd");
		assert_eq!(read("conf.txt.bak"), "x=1\n", "backup must keep the original");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// The vendored `sed` builtin must stream pi...` deleted in theirs

<<<<<<< ours — scope `/// The `xargs` builtin spawns real child pro...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The `xargs` builtin spawns real child processes, but their stdout must
	/// flow back into the shell pipeline (ctx streams, not the host fds), items
	/// must batch per `-n`, and a failing invocation must surface GNU's 123.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_xargs_children_feed_pipeline_and_report_failure() {
		let tmp = std::env::temp_dir().join(format!("tau-xargs-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		// Default echo action: child stdout is captured into the redirect.
		session
			.shell
			.run_string("printf 'a b c\\n' | xargs > xargs.txt", &si, &params)
			.await
			.expect("xargs default");
		assert_eq!(read("xargs.txt"), "a b c\n");
		// -n batching, with child output feeding a downstream builtin stage.
		session
			.shell
			.run_string(
				"printf '1\\n2\\n3\\n4\\n' | xargs -n2 echo | wc -l > batches.txt",
				&si,
				&params,
			)
			.await
			.expect("xargs -n2");
		assert_eq!(read("batches.txt").trim(), "2");
		// A child exiting 1-125 makes xargs exit 123 (GNU contract).
		session
			.shell
			.run_string("printf 'x\\n' | xargs false; printf %s $? > code.txt", &si, &params)
			.await
			.expect("xargs false");
		assert_eq!(read("code.txt"), "123");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// The `xargs` builtin spawns real child pro...` deleted in theirs

<<<<<<< ours — scope `/// The `jq` builtin must evaluate filters ov...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The `jq` builtin must evaluate filters over piped JSON, resolve file
	/// operands against the shell working directory, and propagate `-e`'s
	/// null/false exit status through the shell.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_jq_filters_json_and_propagates_exit_status() {
		let tmp = std::env::temp_dir().join(format!("tau-jq-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).expect("temp dir");
		std::fs::write(tmp.join("in.json"), "{\"name\":\"pi\"}\n").expect("in.json");
		let tmp_str = tmp.to_str().expect("utf8");

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");
		session.shell.set_working_dir(tmp_str).expect("cwd");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let si = SourceInfo::from("tau-natives:test");
		let read = |name: &str| std::fs::read_to_string(tmp.join(name)).unwrap_or_default();

		// Compact filter over piped stdin.
		session
			.shell
			.run_string("printf '{\"a\":{\"b\":2}}' | jq -c .a > jq.txt", &si, &params)
			.await
			.expect("jq pipeline");
		assert_eq!(read("jq.txt"), "{\"b\":2}\n");
		// Raw output from a cwd-relative file operand.
		session
			.shell
			.run_string("jq -r .name in.json > name.txt", &si, &params)
			.await
			.expect("jq file");
		assert_eq!(read("name.txt"), "pi\n");
		// -e maps a null result to exit status 1.
		session
			.shell
			.run_string("printf 'null' | jq -e . > /dev/null; printf %s $? > code.txt", &si, &params)
			.await
			.expect("jq -e");
		assert_eq!(read("code.txt"), "1");

		let _ = std::fs::remove_dir_all(&tmp);
	}
=======
>>>>>>> theirs — scope `/// The `jq` builtin must evaluate filters ov...` deleted in theirs

<<<<<<< ours — scope `/// A stdin-reading builtin blocked on an ope...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// A stdin-reading builtin blocked on an open pipe must honor abort/timeout:
	/// the context's cancel flag makes the read return EOF so the utility
	/// unwinds promptly and the command reports interrupted (130) — it must not
	/// hang or leak a detached thread that keeps the fds alive.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_head_stdin_read_is_cancellable() {
		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");

		// Hold the pipe's write end open with no data so `head` blocks reading.
		let (reader, _writer) = pipe_to_files("cancel").expect("pipe");
		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, OpenFile::from(reader));
		params.set_fd(OpenFiles::STDOUT_FD, null_file().expect("null"));
		params.set_fd(OpenFiles::STDERR_FD, null_file().expect("null"));
		let token = CancellationToken::new();
		params.set_cancel_token(token.clone());
		let si = SourceInfo::from("tau-natives:test");

		let canceller = tokio::spawn(async move {
			time::sleep(Duration::from_millis(150)).await;
			token.cancel();
		});
		let result = time::timeout(
			Duration::from_secs(5),
			session.shell.run_string("head -n 1000000", &si, &params),
		)
		.await;
		let _ = canceller.await;

		let exec = result
			.expect("head must return promptly after cancel, not hang on the open pipe")
			.expect("run_string");
		// Core contract: prompt return (the 5s timeout did NOT fire) proves the
		// read unblocked and the blocking task unwound cleanly — no hang, no
		// detached thread. The interrupted command reports a non-zero status;
		// `run_uutil` yields 130 but brush's run_string maps the cancelled
		// program to its own non-zero code, so we assert the stable contract.
		assert_ne!(
			exit_code(&exec),
			0,
			"cancelled stdin read should report a non-zero (interrupted) status"
		);
	}
=======
>>>>>>> theirs — scope `/// A stdin-reading builtin blocked on an ope...` deleted in theirs

<<<<<<< ours — scope `/// The disable env vars must actually gate r...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// The disable env vars must actually gate registration: the global switch
	/// drops the whole set, and the per-utility destructive switches drop only
	/// the risky shadows.
	#[tokio::test(flavor = "multi_thread")]
	async fn uutils_builtins_respect_disable_env() {
		let session_with = |pairs: &[(&str, &str)]| {
			let map: std::collections::HashMap<String, String> = pairs
				.iter()
				.map(|(k, v)| ((*k).to_string(), (*v).to_string()))
				.collect();
			ShellConfig { session_env: Some(map), snapshot_path: None, minimizer: None }
		};

		let mut default = create_session(&ShellConfig {
			session_env:   Some(hermetic_test_env()),
			snapshot_path: None,
			minimizer:     None,
		})
		.await
		.expect("create_session");
		assert!(default.shell.builtin_mut("head").is_some(), "head registered by default");
		assert!(default.shell.builtin_mut("rg").is_some(), "rg registered by default");
		assert!(default.shell.builtin_mut("rm").is_some(), "rm registered by default");
		assert!(default.shell.builtin_mut("mv").is_some(), "mv registered by default");

		let mut all_off = create_session(&session_with(&[("PI_DISABLE_UUTILS_BUILTINS", "1")]))
			.await
			.expect("create_session");
		assert!(all_off.shell.builtin_mut("head").is_none(), "kill-switch drops head");
		assert!(all_off.shell.builtin_mut("rg").is_none(), "kill-switch drops rg");
		assert!(all_off.shell.builtin_mut("rm").is_none(), "kill-switch drops rm");

		let mut rm_off = create_session(&session_with(&[
			("PI_DISABLE_RM_BUILTIN", "1"),
			("PI_DISABLE_UUTILS_BUILTINS", "0"),
		]))
		.await
		.expect("create_session");
		assert!(rm_off.shell.builtin_mut("rm").is_none(), "rm disabled individually");
		assert!(rm_off.shell.builtin_mut("mv").is_some(), "mv stays enabled");
		assert!(rm_off.shell.builtin_mut("head").is_some(), "head stays enabled");
	}
=======
>>>>>>> theirs — scope `/// The disable env vars must actually gate r...` deleted in theirs

<<<<<<< ours — scope `/// Truth-table coverage for `brush_core::com...` in module `tests`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Truth-table coverage for `brush_core::commands::child_session_action`.
	///
	/// Lives in `tau-natives` because the brush-core crate is excluded from the
	/// workspace (vendored upstream) and cannot be tested standalone — its tokio
	/// dependency only resolves the `net` feature via feature-unification with
	/// other workspace members.
	mod child_session_action {
		use brush_core::commands::{ChildSessionAction, child_session_action};

		/// Interactive brush, leading its own pgroup, terminal stdin: foreground.
		#[test]
		fn interactive_with_terminal_stdin_takes_foreground() {
			assert_eq!(child_session_action(true, true, false), ChildSessionAction::TakeForeground,);
			// Terminal foregrounding wins even when this is the first stage of a
			// pipeline; no detach is attempted.
			assert_eq!(child_session_action(true, true, true), ChildSessionAction::TakeForeground,);
		}

		/// Brush leading a new pgroup with non-terminal stdin always detaches —
		/// including the first stage of a pipeline. `setsid()` keeps the child
		/// off the host's controlling tty; the spawn path skips
		/// `process_group(...)` for detached children, so later stages no longer
		/// try to `setpgid`-join a leader that has moved sessions (the historical
		/// EPERM hazard).
		#[test]
		fn non_terminal_stdin_detaches_regardless_of_pipeline() {
			assert_eq!(child_session_action(true, false, false), ChildSessionAction::DetachSession,);
			assert_eq!(child_session_action(true, false, true), ChildSessionAction::DetachSession,);
		}

		/// Non-interactive brush, terminal stdin, no pipeline: nothing to do.
		#[test]
		fn non_interactive_with_terminal_stdin_does_nothing() {
			assert_eq!(child_session_action(false, true, false), ChildSessionAction::None,);
		}

		/// Non-interactive brush, terminal stdin, joining a pipeline pgroup:
		/// nothing to do (parent already wired pgroup membership).
		#[test]
		fn non_interactive_terminal_stdin_in_pipeline_does_nothing() {
			assert_eq!(child_session_action(false, true, true), ChildSessionAction::None,);
		}

		/// **Embedded host bug fix.** Non-interactive brush, non-terminal stdin,
		/// no pipeline pgroup: detach so the child cannot SIGTTIN/SIGTTOU the
		/// host. This is the case that regressed before this fix and is the
		/// motivating bug for PR #895.
		#[test]
		fn embedded_host_with_non_terminal_stdin_detaches() {
			assert_eq!(child_session_action(false, false, false), ChildSessionAction::DetachSession,);
		}

		/// **Pipeline tty-safety.** Non-interactive brush, non-terminal stdin
		/// (pipe), and a multi-command pipeline: detach. An interactive child in
		/// a pipeline (`zsh -i ... | awk`) would otherwise open `/dev/tty`,
		/// `tcsetpgrp` itself to the foreground, and leave the host stopped on
		/// its next tty read (`suspended (tty input)`). Each stage gets its own
		/// session instead; the embedded host cancels via the descendant tree,
		/// not a shared pgroup, and pipes are session-independent.
		#[test]
		fn pipeline_stage_with_non_terminal_stdin_detaches() {
			assert_eq!(child_session_action(false, false, true), ChildSessionAction::DetachSession,);
		}
	}
=======
>>>>>>> theirs — scope `/// Truth-table coverage for `brush_core::com...` deleted in theirs

<<<<<<< ours — scope `#[cfg(unix)]` in module `tests`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	#[cfg(unix)]
	fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
		let mut path = std::env::temp_dir();
		let nonce = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.expect("system time")
			.as_nanos();
		path.push(format!("tau-shell-{prefix}-{}-{nonce}", std::process::id()));
		std::fs::create_dir_all(&path).expect("create temp dir");
		path
	}
=======
>>>>>>> theirs — scope `#[cfg(unix)]` deleted in theirs

<<<<<<< ours — scope `/// Regression: a `&&` / `;` chain whose late...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Regression: a `&&` / `;` chain whose later pipeline stage is a compound
	/// command (`while … done`) must execute instead of failing with
	/// "tau-natives:command: syntax error at end of input". The segmented chain
	/// runner rebuilt each segment via the brush AST `Display` impl, but only
	/// validated the *first* pipeline stage — so a compound later stage was
	/// reconstructed without its terminator and re-run as invalid shell. Such a
	/// command now bails out of segmentation and runs whole via the single path.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn compound_stage_in_chain_runs_via_single_path() {
		let root = unique_temp_dir("compound-chain");
		let minimizer = printf_minimizer(&root.join("minimizer.toml"), None);
		let (result, output) = run_command_capture(
			"printf 'start\\n' && seq 5 | while read n; do echo \"n=$n\"; done | head -2",
			None,
			Some(minimizer),
			CancelToken::default(),
		)
		.await;
		let _ = std::fs::remove_dir_all(&root);
		assert_eq!(result.exit_code, Some(0));
		assert_eq!(output, "start\nn=1\nn=2\n");
		assert!(!output.contains("syntax error"));
		// Ran whole (unsegmented), so nothing was minimized.
		assert!(result.minimized.is_none());
	}
=======
>>>>>>> theirs — scope `/// Regression: a `&&` / `;` chain whose late...` deleted in theirs
<<<<<<< ours — scope `/// End-to-end verification that brush, when ...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// End-to-end verification that brush, when embedded as a non-interactive
	/// library (`interactive: false`, exactly what `create_session` produces),
	/// spawns external commands in a **separate session** from the host.
	///
	/// The truth-table tests in `child_session_action` cover the decision in
	/// isolation. This test covers the wiring: it boots a real `BrushShell`,
	/// runs a child that prints its PID then sleeps, and asks the kernel for
	/// that PID's session via `getsid(2)` while the child is still alive.
	/// Pre-fix (`new_pg=false` skipped `detach_session`), the child inherited
	/// the host's session, so `getsid(child_pid) == getsid(0)`. Post-fix,
	/// `setsid` ran and the child is its own session leader
	/// (`getsid(child_pid) == child_pid`).
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn embedded_external_command_runs_in_its_own_session() {
		use std::io::Read as _;

		// SAFETY: `getsid(0)` only queries the current process session; the
		// return value is checked. Inside a PID namespace (the containerized CI
		// runner) the host's session leader can live outside the namespace, so
		// `getsid(0)` legitimately reports 0 — only -1 is a real failure. The
		// child-session invariants below (own session, distinct from host) stay
		// meaningful.
		let host_sid = unsafe { libc::getsid(0) };
		assert!(host_sid >= 0, "getsid(0) failed: {}", std::io::Error::last_os_error());

		// Build the same kind of session tau-natives uses in production.
		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");

		// Output pipe shared between the brush child and a concurrent reader. The
		// reader runs on a blocking thread because `os_pipe` reads are blocking.
		let (mut reader, writer) = pipe_to_files("e2e").expect("pipe");
		let stdout_file = OpenFile::from(writer.try_clone().expect("clone"));
		let stderr_file = OpenFile::from(writer);

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, stdout_file);
		params.set_fd(OpenFiles::STDERR_FD, stderr_file);

		// (pid_tx, pid_rx) — reader task signals the test as soon as it has the
		// PID.
		let (pid_tx, pid_rx) = tokio::sync::oneshot::channel::<i32>();
		let reader_handle = tokio::task::spawn_blocking(move || {
			let mut buf = Vec::new();
			// Read just enough to capture the PID line. The child sleeps after
			// printing so the pipe will not back-pressure.
			let mut chunk = [0u8; 64];
			let mut pid_tx = Some(pid_tx);
			while let Ok(n) = reader.read(&mut chunk)
				&& n > 0
			{
				buf.extend_from_slice(&chunk[..n]);
				if pid_tx.is_some()
					&& let Some(line_end) = buf.iter().position(|&byte| byte == b'\n')
					&& let Ok(line) = std::str::from_utf8(&buf[..line_end])
					&& let Ok(pid) = line.trim().parse::<i32>()
				{
					let _ = pid_tx
						.take()
						.expect("pid sender should be present")
						.send(pid);
				}
			}
			buf
		});

		// Run brush in the background so we can call `getsid(child_pid)` while
		// the child is still alive.
		let shell_handle = tokio::spawn(async move {
			let source_info = SourceInfo::from("tau-natives:test");
			// `printf '%d\n' "$$"` then `sleep 0.5`. Long enough for our `getsid`.
			let exec = session
				.shell
				.run_string("sh -c 'printf \"%d\\n\" \"$$\"; sleep 0.5'", &source_info, &params)
				.await
				.expect("run_string");
			drop(params);
			(session, exec)
		});

		let child_pid = time::timeout(Duration::from_secs(5), pid_rx)
			.await
			.expect("timed out waiting for child PID")
			.expect("reader closed pid channel without sending");
		assert!(child_pid > 0, "got non-positive child pid: {child_pid}");

		// Snapshot the child's session ID immediately, while the child is still
		// in `sleep`. POSIX guarantees `getsid` against a live PID returns the
		// session of that process.
		// SAFETY: `child_pid` is a positive PID from the child; errors are
		// reported via the checked return value.
		let child_sid = unsafe { libc::getsid(child_pid) };
		assert!(
			child_sid > 0,
			"getsid({child_pid}) failed: {} (child may have already exited)",
			std::io::Error::last_os_error(),
		);

		// Drain the brush task and the pipe reader.
		let (_session, exec) = time::timeout(Duration::from_secs(5), shell_handle)
			.await
			.expect("shell timed out")
			.expect("shell task panicked");
		assert!(
			matches!(exec.exit_code, ExecutionExitCode::Success),
			"unexpected exit: {}",
			exit_code(&exec),
		);
		let _ = time::timeout(Duration::from_secs(2), reader_handle).await;

		assert_ne!(
			child_sid, host_sid,
			"child PID {child_pid} inherited host session {host_sid}; setsid() did not run — the \
			 embedded-host bug is back",
		);
		assert_eq!(
			child_sid, child_pid,
			"child PID {child_pid} should be its own session leader after setsid",
		);
	}
=======
>>>>>>> theirs — scope `/// End-to-end verification that brush, when ...` deleted in theirs

<<<<<<< ours — scope `/// Regression for the `suspended (tty input)...` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	/// Regression for the `suspended (tty input)` bug: an **interactive child
	/// inside a pipeline** (`zsh -i ... | awk`) used to stay in the host
	/// session, open `/dev/tty`, `tcsetpgrp` itself to the foreground, and
	/// leave the embedded host (TAU) stopped on its next tty read. The earlier
	/// embedded-host fix carved pipelines out of `detach_session` because a
	/// later stage that `setpgid`-joined a detached leader failed with EPERM.
	///
	/// This test boots a real embedded `BrushShell` and runs a two-stage
	/// pipeline whose first stage prints its PID then sleeps (forwarded to us
	/// by `cat`). It asserts two contracts at once:
	///   1. the first stage runs in its **own session** (`getsid == own pid`),
	///      so it can never reach the host's controlling tty — guards the
	///      decision; and
	///   2. the pipeline still exits **successfully**, proving the second stage
	///      spawned without the cross-session `setpgid` EPERM — guards the
	///      wiring that skips `process_group(...)` for detached children.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn embedded_pipeline_stage_runs_in_its_own_session() {
		use std::io::Read as _;

		// SAFETY: `getsid(0)` only queries the current process session; checked
		// below. In a PID namespace (containerized CI) the host's session leader
		// can live outside the namespace, so `getsid(0)` reports 0, not an error;
		// only -1 is a real failure.
		let host_sid = unsafe { libc::getsid(0) };
		assert!(host_sid >= 0, "getsid(0) failed: {}", std::io::Error::last_os_error());

		let config = ShellConfig { session_env: None, snapshot_path: None, minimizer: None };
		let mut session = create_session(&config).await.expect("create_session");

		let (mut reader, writer) = pipe_to_files("e2e-pipe").expect("pipe");
		let stdout_file = OpenFile::from(writer.try_clone().expect("clone"));
		let stderr_file = OpenFile::from(writer);

		let mut params = session.shell.default_exec_params();
		params.set_fd(OpenFiles::STDIN_FD, null_file().expect("null stdin"));
		params.set_fd(OpenFiles::STDOUT_FD, stdout_file);
		params.set_fd(OpenFiles::STDERR_FD, stderr_file);

		let (pid_tx, pid_rx) = tokio::sync::oneshot::channel::<i32>();
		let reader_handle = tokio::task::spawn_blocking(move || {
			let mut buf = Vec::new();
			let mut chunk = [0u8; 64];
			let mut pid_tx = Some(pid_tx);
			while let Ok(n) = reader.read(&mut chunk)
				&& n > 0
			{
				buf.extend_from_slice(&chunk[..n]);
				if pid_tx.is_some()
					&& let Some(line_end) = buf.iter().position(|&byte| byte == b'\n')
					&& let Ok(line) = std::str::from_utf8(&buf[..line_end])
					&& let Ok(pid) = line.trim().parse::<i32>()
				{
					let _ = pid_tx
						.take()
						.expect("pid sender should be present")
						.send(pid);
				}
			}
			buf
		});

		let shell_handle = tokio::spawn(async move {
			let source_info = SourceInfo::from("tau-natives:test");
			// First stage prints its own PID and sleeps; `sh -c cat` forwards
			// the PID line to our reader and exits on EOF. The first stage
			// leads the pipeline's process group, while the second stage is the
			// join-or-detach process that would EPERM without the wiring fix.
			let exec = session
				.shell
				.run_string(
					"sh -c 'printf \"%d\\n\" \"$$\"; sleep 1' | sh -c cat",
					&source_info,
					&params,
				)
				.await
				.expect("run_string");
			drop(params);
			(session, exec)
		});

		let child_pid = time::timeout(Duration::from_secs(5), pid_rx)
			.await
			.expect("timed out waiting for first-stage PID")
			.expect("reader closed pid channel without sending");
		assert!(child_pid > 0, "got non-positive child pid: {child_pid}");

		// SAFETY: `child_pid` is a live positive PID (still in `sleep`); the
		// return value is checked.
		let child_sid = unsafe { libc::getsid(child_pid) };
		assert!(
			child_sid > 0,
			"getsid({child_pid}) failed: {} (child may have already exited)",
			std::io::Error::last_os_error(),
		);

		let (_session, exec) = time::timeout(Duration::from_secs(5), shell_handle)
			.await
			.expect("shell timed out")
			.expect("shell task panicked");
		// Guards the wiring: the second stage spawned without a cross-session
		// `setpgid` EPERM, so the whole pipeline succeeded.
		assert!(
			matches!(exec.exit_code, ExecutionExitCode::Success),
			"pipeline did not succeed (second stage may have hit setpgid EPERM): {}",
			exit_code(&exec),
		);
		let _ = time::timeout(Duration::from_secs(2), reader_handle).await;

		// Guards the decision: a pipeline stage must not share the host session,
		// or it could seize the controlling tty and SIGTTIN the host.
		assert_ne!(
			child_sid, host_sid,
			"pipeline stage PID {child_pid} inherited host session {host_sid}; it could seize the \
			 controlling tty — the pipeline tty-suspend bug is back",
		);
		assert_eq!(
			child_sid, child_pid,
			"pipeline stage PID {child_pid} should be its own session leader after setsid",
		);
	}
=======
>>>>>>> theirs — scope `/// Regression for the `suspended (tty input)...` deleted in theirs

<<<<<<< ours — scope `#[cfg(unix)]` in module `tests`, deleted in theirs (T+F, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn wait_n_p_records_completed_process_id() {
		let options = ShellExecuteOptions {
			command: "sh -c 'sleep 0.2; exit 42' & slow=$!; sh -c 'exit 13' & fast=$!; wait -n -p \
			          hit \"$slow\" \"$fast\"; status=$?; wait \"$slow\"; [ \"$status\" -eq 13 ] && \
			          [ \"$hit\" = \"$fast\" ]"
				.to_string(),
			..Default::default()
		};

		let result = execute_shell(options, None, CancelToken::default())
			.await
			.expect("execute should succeed");

		assert_eq!(result.exit_code, Some(0));
		assert!(!result.cancelled);
		assert!(!result.timed_out);
	}

	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn wait_f_accepts_process_id() {
		let options = ShellExecuteOptions {
			command: "sh -c 'exit 5' & child=$!; wait -f \"$child\"".to_string(),
			..Default::default()
		};

		let result = execute_shell(options, None, CancelToken::default())
			.await
			.expect("execute should succeed");

		assert_eq!(result.exit_code, Some(5));
		assert!(!result.cancelled);
		assert!(!result.timed_out);
	}
	#[tokio::test]
	async fn abort_state_signals_cancel_token() {
		let abort_state = ShellAbortState::default();
		let mut cancel_token = CancelToken::default();
		let abort_token = cancel_token.emplace_abort_token();

		abort_state.set(abort_token).await;
		abort_state.abort().await;

		let reason = time::timeout(Duration::from_millis(100), cancel_token.wait())
			.await
			.expect("cancel token should be signalled");
		assert!(matches!(reason, AbortReason::Signal));
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn read_output_stops_when_cancelled_before_pipe_eof() {
		let (reader, _writer) = pipe_to_files("test").expect("test pipe should be created");
		let cancel = CancellationToken::new();
		let (activity_tx, _activity_rx) = flume::bounded(1);
		let handle = tokio::spawn(read_output(reader, None, cancel.clone(), activity_tx));

		time::sleep(Duration::from_millis(10)).await;
		cancel.cancel();

		time::timeout(Duration::from_millis(100), handle)
			.await
			.expect("reader task should stop after cancellation")
			.expect("reader task should not panic");
	}

	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn execute_shell_streams_separates_stdout_and_stderr() {
		let (stdout_tx, stdout_rx) = flume::unbounded::<Bytes>();
		let (stderr_tx, stderr_rx) = flume::unbounded::<Bytes>();
		let options = ShellExecuteOptions {
			command: "echo out; echo err 1>&2".to_string(),
			..Default::default()
		};
		let streams = StreamSinks { stdout: Some(stdout_tx), stderr: Some(stderr_tx) };
		let result = execute_shell_streams(options, streams, CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(0));
		assert!(!result.cancelled);

		let mut stdout = Vec::new();
		while let Ok(chunk) = stdout_rx.recv_async().await {
			stdout.extend_from_slice(&chunk);
		}
		let mut stderr = Vec::new();
		while let Ok(chunk) = stderr_rx.recv_async().await {
			stderr.extend_from_slice(&chunk);
		}
		assert_eq!(stdout, b"out\n");
		assert_eq!(stderr, b"err\n");
	}

	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn execute_shell_streams_works_when_sinks_are_none() {
		// Both sinks `None` — pipes must still drain so the child can exit.
		let options = ShellExecuteOptions {
			command: "yes done | head -n 100 1>&2; echo final".to_string(),
			..Default::default()
		};
		let result = execute_shell_streams(options, StreamSinks::default(), CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(0));
	}

	/// Brush expands `$env:NAME` against the `env` shell variable by default,
	/// collapsing PowerShell references like `Write-Host $env:TAUCODE` to
	/// `:TAUCODE`. The session-level fallback below defines `env=$env` so the
	/// expansion is the literal `$env:TAUCODE`, preserving the PowerShell
	/// token when the command is forwarded to a child shell.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn powershell_env_reference_survives_brush_expansion() {
		let (tx, rx) = flume::unbounded::<Bytes>();
		let options = ShellExecuteOptions {
			command: "printf '%s' \"$env:SystemRoot\"".to_string(),
			..Default::default()
		};
		let streams = StreamSinks { stdout: Some(tx), stderr: None };
		let result = execute_shell_streams(options, streams, CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(0));

		let mut stdout = Vec::new();
		while let Ok(chunk) = rx.recv_async().await {
			stdout.extend_from_slice(&chunk);
		}
		assert_eq!(stdout, b"$env:SystemRoot");
	}

	/// A user assignment to `env` in the command itself must shadow the
	/// session-level fallback so callers that genuinely use a POSIX variable
	/// named `env` see their value, not the literal `$env`.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn user_env_assignment_shadows_powershell_fallback() {
		let (tx, rx) = flume::unbounded::<Bytes>();
		let options = ShellExecuteOptions {
			command: "env=prod; printf '%s' \"$env:8080\"".to_string(),
			..Default::default()
		};
		let streams = StreamSinks { stdout: Some(tx), stderr: None };
		let result = execute_shell_streams(options, streams, CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(0));

		let mut stdout = Vec::new();
		while let Ok(chunk) = rx.recv_async().await {
			stdout.extend_from_slice(&chunk);
		}
		assert_eq!(stdout, b"prod:8080");
	}

	/// Quoted heredoc delimiters at EOF must behave like bash. `brush-parser`
	/// currently rejects that shape unless the input stream ends with a newline,
	/// which surfaced as `unterminated here document sequence; tag(s) [...]` for
	/// normal paste-run Python snippets.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn quoted_heredoc_without_trailing_newline_runs() {
		let (result, output) =
			run_command_capture("cat <<'PY'\nhello $USER\nPY", None, None, CancelToken::default())
				.await;

		assert_eq!(result.exit_code, Some(0));
		assert_eq!(output, "hello $USER\n");
	}

	/// Regression for a Windows/macOS deadlock in
	/// `brush_core::interp::setup_open_file_with_contents`. The body is
	/// 256 KiB — well past the default pipe buffer on every platform
	/// (Windows ~4 KiB, macOS 16-64 KiB, Linux 64 KiB), so any inline
	/// `write_all` on the calling thread blocks forever. The `:` builtin
	/// never reads its stdin, so the only way `echo done` runs is if the
	/// heredoc writer is decoupled from the main thread (or, on Linux,
	/// the pipe buffer was grown via `F_SETPIPE_SZ`). The
	/// `tokio::time::timeout` is the safety net that turns a regression
	/// into a 10 s failure instead of hanging CI for the full
	/// hard-timeout window.
	#[tokio::test(flavor = "multi_thread")]
	async fn large_heredoc_does_not_deadlock() {
		let body = "X".repeat(256 * 1024);
		let command = format!(": <<'EOF'\n{body}\nEOF\necho done");
		let options = ShellExecuteOptions { command, ..Default::default() };

		let result = time::timeout(
			Duration::from_secs(10),
			execute_shell(options, None, CancelToken::default()),
		)
		.await
		.expect("execute_shell hung past 10 s — heredoc writer deadlocked")
		.expect("execute_shell errored");

		assert_eq!(result.exit_code, Some(0), "command did not run to completion");
	}

	/// The `nohup` builtin runs its operand command and surfaces that command's
	/// own exit status — not nohup's (`125`/`126`/`127`) error codes.
	#[tokio::test(flavor = "multi_thread")]
	async fn nohup_builtin_propagates_command_exit_code() {
		let command = if cfg!(windows) {
			"nohup cmd /C exit 7"
		} else {
			"nohup sh -c 'exit 7'"
		};
		let options = ShellExecuteOptions { command: command.to_string(), ..Default::default() };
		let result = execute_shell(options, None, CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(7));
		assert!(!result.cancelled);
		assert!(!result.timed_out);
	}

	/// `nohup` is a no-op builtin in this embedded shell, but `nohup cmd &`
	/// must still behave like a process-launching background command for `$!`.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn nohup_background_captures_operand_pid() {
		let (tx, rx) = flume::unbounded::<String>();
		let options = ShellExecuteOptions {
			command: "nohup sh -c 'exit 0' >/dev/null 2>&1 & pid=$!; printf 'pid=%s\n' \"$pid\"; \
			          test -n \"$pid\""
				.to_string(),
			..Default::default()
		};
		let result = execute_shell(options, Some(tx), CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(0));
		assert!(!result.cancelled);
		assert!(!result.timed_out);

		let mut out = String::new();
		while let Ok(chunk) = rx.recv_async().await {
			out.push_str(&chunk);
		}
		let pid = out
			.trim()
			.strip_prefix("pid=")
			.expect("nohup background PID output should include pid= prefix");
		assert!(pid.parse::<i32>().is_ok_and(|pid| pid > 0), "invalid PID output: {out:?}");
	}

	/// `nohup` with no operand mirrors coreutils: a `missing operand` diagnostic
	/// and exit code 125 (a nohup-level error, distinct from any command code).
	#[tokio::test(flavor = "multi_thread")]
	async fn nohup_builtin_without_command_reports_missing_operand() {
		let (tx, rx) = flume::unbounded::<String>();
		let options = ShellExecuteOptions { command: "nohup".to_string(), ..Default::default() };
		let result = execute_shell(options, Some(tx), CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(125));
		let mut out = String::new();
		while let Ok(chunk) = rx.recv_async().await {
			out.push_str(&chunk);
		}
		assert!(
			out.contains("missing operand"),
			"expected a missing-operand diagnostic, got: {out:?}"
		);
	}

	/// The contract that makes this a *builtin* and not the external tool: the
	/// child must **not** inherit `SIGHUP = SIG_IGN`. Real `nohup` masks SIGHUP
	/// (and it survives `exec`), so a process launched through `/usr/bin/nohup`
	/// reports `IGN` here; the builtin runs the command as an ordinary
	/// descendant, so it reports `DFL` and dies with the host on hangup. The
	/// probe needs `getsid`-style signal introspection, so it is gated on
	/// `python3` (skipped, not failed, when absent — matching the embedded
	/// session-detach e2e suite).
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn nohup_builtin_does_not_mask_sighup() {
		let python_ok = std::process::Command::new("python3")
			.arg("-c")
			.arg("pass")
			.stdout(std::process::Stdio::null())
			.stderr(std::process::Stdio::null())
			.status()
			.is_ok_and(|status| status.success());
		if !python_ok {
			eprintln!("skipping nohup_builtin_does_not_mask_sighup: python3 unavailable");
			return;
		}

		let probe = "import signal,sys; sys.stdout.write('IGN' if \
		             signal.getsignal(signal.SIGHUP)==signal.SIG_IGN else 'DFL')";
		let (tx, rx) = flume::unbounded::<String>();
		let options = ShellExecuteOptions {
			command: format!("nohup python3 -c \"{probe}\""),
			..Default::default()
		};
		let result = execute_shell(options, Some(tx), CancelToken::default())
			.await
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(0));
		let mut out = String::new();
		while let Ok(chunk) = rx.recv_async().await {
			out.push_str(&chunk);
		}
		assert!(
			out.contains("DFL") && !out.contains("IGN"),
			"builtin nohup masked SIGHUP like the external tool (output: {out:?})",
		);
	}

	/// Regression for #4078: the JS bridge hands the pipe readers a *bounded*
	/// chunk channel. With a consumer slower than the producer the readers
	/// must park on `send_async` (backpressuring the child through its pipe)
	/// rather than buffer unboundedly — and, unlike a drop-on-full design,
	/// every produced byte must still reach the consumer.
	#[cfg(unix)]
	#[tokio::test(flavor = "multi_thread")]
	async fn streaming_output_backpressures_on_bounded_channel_without_loss() {
		const TOTAL_BYTES: usize = 1_048_576;
		let (tx, rx) = flume::bounded::<String>(4);
		let options = ShellExecuteOptions {
			command: format!("yes x | head -c {TOTAL_BYTES}"),
			..Default::default()
		};
		let run = tokio::spawn(execute_shell(options, Some(tx), CancelToken::default()));

		let mut received = 0usize;
		while let Ok(chunk) = rx.recv_async().await {
			received += chunk.len();
			// Slow consumer: forces the bounded queue to fill and the readers
			// to park between chunks.
			time::sleep(Duration::from_micros(50)).await;
		}

		let result = time::timeout(Duration::from_secs(30), run)
			.await
			.expect("command should finish despite backpressure")
			.expect("run task should not panic")
			.expect("execute should succeed");
		assert_eq!(result.exit_code, Some(0));
		assert!(!result.cancelled);
		assert!(!result.timed_out);
		assert_eq!(received, TOTAL_BYTES, "streamed bytes were dropped under backpressure");
	}
=======
>>>>>>> theirs — scope `#[cfg(unix)]` deleted in theirs
