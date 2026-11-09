//! Regex search exported via N-API.
//!
//! Provides two layers:
//! - `search()` for in-memory content search.
//! - `grep()` for filesystem search with glob/type filtering.
//!
//! `pi_walker::grep` owns compilation, scanning, walking, and result selection;
//! this module decodes options and converts results.

use std::{path::Path, sync::Arc};

use grep_matcher::Matcher;
use napi::{
	JsString,
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;
use pi_vfs::Fs;
use pi_walker::grep::Engine;
use tokio::sync::mpsc;

use crate::{shell::vfs::ShellFilesystem, task, utils::clamp_u32};

/// Maximum batches queued between the search and the `onMatches` forwarder.
const GREP_STREAM_QUEUE: usize = 4;
/// Most matches handed to one `onMatches` call.
const STREAM_BATCH: usize = 1024;

/// `onMatches` callback, called without the error-first slot.
type GrepStreamCallback =
	ThreadsafeFunction<Vec<GrepMatch>, UnknownReturnValue, Vec<GrepMatch>, Status, false, false>;
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// PCRE2 JIT toggle: `TAU_PCRE2_JIT=1` forces JIT on, `0`/`false` forces it
/// off. Unset, JIT stays on everywhere except macOS, where PCRE2's SLJIT
/// executable allocator can fault while compiling patterns (issue #7399).
static PCRE2_JIT_ENABLED: LazyLock<bool> = LazyLock::new(|| match std::env::var("TAU_PCRE2_JIT") {
	Ok(v) if !v.is_empty() => v != "0" && !v.eq_ignore_ascii_case("false"),
	_ => !cfg!(target_os = "macos"),
});

/// Output mode for [`search`] and [`grep`] (string values match JS callers).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[napi(string_enum)]
pub enum GrepOutputMode {
	/// Emit matched lines (and optional context lines).
	#[napi(value = "content")]
	Content,
	/// Emit per-file or total counts instead of line content.
	#[napi(value = "count")]
	Count,
	/// Emit one row per file that matched, without line content.
	#[napi(value = "filesWithMatches")]
	FilesWithMatches,
}

/// Options for searching file content.
#[napi(object)]
pub struct SearchOptions {
	/// Regex pattern to search for.
	pub pattern:        String,
	/// Case-insensitive search.
	pub ignore_case:    Option<bool>,
	/// Enable multiline matching.
	pub multiline:      Option<bool>,
	/// Maximum number of matches to return.
	pub max_count:      Option<u32>,
	/// Skip first N matches.
	pub offset:         Option<u32>,
	/// Lines of context before matches.
	pub context_before: Option<u32>,
	/// Lines of context after matches.
	pub context_after:  Option<u32>,
	/// Lines of context before/after matches (legacy).
	pub context:        Option<u32>,
	/// Truncate lines longer than this (characters).
	pub max_columns:    Option<u32>,
	/// Output mode (content or count).
	pub mode:           Option<GrepOutputMode>,
}

/// Options for searching files on disk.
#[napi(object, object_to_js = false)]
pub struct GrepOptions<'env> {
	/// Regex pattern to search for.
	pub pattern:            String,
	/// Directory or file to search: a host path or an absolute `scheme://` URL.
	pub path:               String,
	/// Glob filter for file paths (e.g., "*.ts"); a matched directory selects
	/// every file under it.
	pub glob:               Option<String>,
	/// Glob patterns of files and directories to leave out, relative to `path`:
	/// one without `/` matches at any depth (`*.test.ts`, `vendor`), a leading
	/// `/` anchors it to `path` (`/vendor`); a matched directory is not
	/// searched.
	pub exclude:            Option<Vec<String>>,
	/// Match simple glob patterns at any depth (default: true; `*.ts` ->
	/// `**/*.ts`). Set false when `glob` is already relative to `path`.
	pub recursive:          Option<bool>,
	/// Filter by file type (e.g., "js", "py", "rust").
	pub r#type:             Option<String>,
	/// Case-insensitive search.
	pub ignore_case:        Option<bool>,
	/// Enable multiline matching.
	pub multiline:          Option<bool>,
	/// Include hidden files (default: true).
	pub hidden:             Option<bool>,
	/// Respect .gitignore files (default: true).
	pub gitignore:          Option<bool>,
	/// Maximum number of matches to return.
	pub max_count:          Option<u32>,
	/// Skip first N matches.
	pub offset:             Option<u32>,
	/// Lines of context before matches.
	pub context_before:     Option<u32>,
	/// Lines of context after matches.
	pub context_after:      Option<u32>,
	/// Lines of context before/after matches (legacy).
	pub context:            Option<u32>,
	/// Truncate lines longer than this (characters).
	pub max_columns:        Option<u32>,
	/// Output mode (content, filesWithMatches, or count).
	pub mode:               Option<GrepOutputMode>,
	/// Maximum matches collected per file (content mode). Keeps one hot file
	/// from exhausting the global `max_count` budget before other files are
	/// reached.
	pub max_count_per_file: Option<u32>,
	/// Abort signal for cancelling the operation.
	pub signal:             Option<Unknown<'env>>,
	/// Timeout in milliseconds for the operation.
	pub timeout_ms:         Option<u32>,
	/// Filesystem every path is stat'ed, walked, and read through (native when
	/// absent).
	pub filesystem:         Option<ShellFilesystem>,
	/// Stream results instead of returning them: called on the JS thread with
	/// batches (at most 1024 entries, files in no particular order) of what
	/// `matches` would hold, while the search runs. A slow callback pauses the
	/// search instead of buffering. Successful completion waits for every
	/// callback and carries counts with empty `matches`; cancellation also
	/// interrupts delivery waits, though already queued callbacks may still run.
	/// A throw rejects the search with it. Incompatible with `maxCount` and
	/// `offset`.
	#[napi(ts_type = "(matches: GrepMatch[]) => void")]
	pub on_matches:         Option<GrepStreamCallback>,
}

/// A context line (before or after a match).
#[derive(Clone, Debug)]
#[napi(object)]
pub struct ContextLine {
	/// 1-indexed line number in the source file.
	pub line_number: u32,
	/// Raw line content (trimmed line ending).
	pub line:        String,
}

/// A single match in the content.
#[napi(object)]
pub struct Match {
	/// 1-indexed line number.
	pub line_number:    u32,
	/// The matched line content.
	pub line:           String,
	/// Context lines before the match.
	pub context_before: Option<Vec<ContextLine>>,
	/// Context lines after the match.
	pub context_after:  Option<Vec<ContextLine>>,
	/// Whether the line was truncated.
	pub truncated:      Option<bool>,
	/// 1-indexed character column where the first match on a truncated line
	/// starts; the truncated `line` shows a window around it.
	pub column:         Option<u32>,
}

/// Result of searching content.
#[napi(object)]
pub struct SearchResult {
	/// All matches found.
	pub matches:       Vec<Match>,
	/// Total number of matches (may exceed `matches.len()` due to offset/limit).
	pub match_count:   u32,
	/// Whether the limit was reached.
	pub limit_reached: bool,
	/// Error message, if any.
	pub error:         Option<String>,
}

/// A single match in a grep result.
#[derive(Clone)]
#[napi(object)]
pub struct GrepMatch {
	/// File path for the match (relative for directory searches).
	pub path:           String,
	/// 1-indexed line number (0 for count-only entries).
	pub line_number:    u32,
	/// The matched line content (empty for count-only entries).
	pub line:           String,
	/// Context lines before the match.
	pub context_before: Option<Vec<ContextLine>>,
	/// Context lines after the match.
	pub context_after:  Option<Vec<ContextLine>>,
	/// Whether the line was truncated.
	pub truncated:      Option<bool>,
	/// 1-indexed character column where the first match on a truncated line
	/// starts; the truncated `line` shows a window around it.
	pub column:         Option<u32>,
	/// Per-file match count (count mode only).
	pub match_count:    Option<u32>,
}

/// Result of searching files.
#[napi(object)]
pub struct GrepResult {
	/// Matches or per-file counts, depending on output mode.
	pub matches:            Vec<GrepMatch>,
	/// Total matches across all files, or matched file count in filesWithMatches
	/// mode.
	pub total_matches:      u32,
	/// Number of files with at least one match.
	pub files_with_matches: u32,
	/// Number of files searched.
	pub files_searched:     u32,
	/// Whether the limit/offset stopped the search early.
	pub limit_reached:      Option<bool>,
	/// Number of files skipped because they exceed the size limit.
	pub skipped_oversized:  Option<u32>,
}

const fn to_mode(mode: Option<GrepOutputMode>) -> pi_walker::grep::Mode {
	match mode {
		None | Some(GrepOutputMode::Content) => pi_walker::grep::Mode::Content,
		Some(GrepOutputMode::Count) => pi_walker::grep::Mode::Count,
		Some(GrepOutputMode::FilesWithMatches) => pi_walker::grep::Mode::FilesWithMatches,
	}
}

/// Legacy `context` applies only when neither `contextBefore` nor
/// `contextAfter` is given.
fn resolve_context(
	context: Option<u32>,
	context_before: Option<u32>,
	context_after: Option<u32>,
) -> (usize, usize) {
	let (before, after) = if context_before.is_some() || context_after.is_some() {
		(context_before.unwrap_or(0), context_after.unwrap_or(0))
	} else {
		let value = context.unwrap_or(0);
		(value, value)
	};
	(before as usize, after as usize)
}

fn to_context_lines(lines: Vec<pi_walker::grep::ContextLine>) -> Option<Vec<ContextLine>> {
	(!lines.is_empty()).then(|| {
		lines
			.into_iter()
			.map(|line| ContextLine { line_number: clamp_u32(line.line), line: line.text })
			.collect()
	})
}

impl From<pi_walker::grep::Match> for Match {
	fn from(matched: pi_walker::grep::Match) -> Self {
		Self {
			line_number:    clamp_u32(matched.line),
			line:           matched.text,
			context_before: to_context_lines(matched.before),
			context_after:  to_context_lines(matched.after),
			truncated:      matched.truncated.then_some(true),
			column:         matched.column,
		}
	}
}

impl From<pi_walker::grep::Match> for GrepMatch {
	fn from(matched: pi_walker::grep::Match) -> Self {
		Self {
			path:           matched.path,
			line_number:    clamp_u32(matched.line),
			line:           matched.text,
			context_before: to_context_lines(matched.before),
			context_after:  to_context_lines(matched.after),
			truncated:      matched.truncated.then_some(true),
			column:         matched.column,
			match_count:    matched.count.map(clamp_u32),
		}
	}
}

const fn empty_search_result(error: Option<String>) -> SearchResult {
	SearchResult { matches: Vec::new(), match_count: 0, limit_reached: false, error }
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
fn build_grep_walk_request(
	search_path: &Path,
	glob: Option<&str>,
	include_hidden: bool,
	use_gitignore: bool,
	skip_node_modules: bool,
	order: tau_walker::WalkOrder,
) -> Result<tau_walker::WalkRequest> {
	let mut filter = tau_walker::WalkFilter::files_only();
	if let Some(glob) = glob.map(str::trim).filter(|value| !value.is_empty()) {
		let pattern = glob_util::build_glob_pattern(glob, true);
		let compiled = tau_walker::CompiledWalkGlob::new([pattern])
			.map_err(|err| Error::from_reason(format!("Invalid glob pattern: {err}")))?;
		filter = filter.glob(compiled);
	}

	Ok(tau_walker::WalkRequest::new(search_path)
		.hidden(include_hidden)
		.gitignore(use_gitignore)
		.skip_git(true)
		.skip_node_modules(skip_node_modules)
		.follow_links(tau_walker::FollowLinks::Never)
		.detail(tau_walker::WalkDetail::Minimal)
		.size_hints(tau_walker::SizeHintPolicy::WhenCheap)
		.order(order)
		.emit_root(false)
		.depth(1, usize::MAX)
		.directory_errors(tau_walker::DirectoryErrorMode::SkipSkippable)
		.cache(false)
		.filter(filter))
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
fn collect_grep_candidates(
	search_path: &Path,
	glob: Option<&str>,
	type_filter: Option<&TypeFilter>,
	include_hidden: bool,
	use_gitignore: bool,
	skip_node_modules: bool,
	order: tau_walker::WalkOrder,
	ct: &task::CancelToken,
) -> Result<Option<Vec<tau_walker::FileCandidate>>> {
	let request = build_grep_walk_request(
		search_path,
		glob,
		include_hidden,
		use_gitignore,
		skip_node_modules,
		order,
	)?;
	let mut candidates = match request.collect_file_candidates_with_heartbeat(|| ct.heartbeat()) {
		Ok(candidates) => candidates,
		Err(err) => return Err(iofs::map_walker_error(err)),
	};
	if let Some(filter) = type_filter {
		candidates.retain(|candidate| matches_type_filter_str(&candidate.relative, filter));
	}
	Ok(Some(candidates))
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// Shared accumulator across both search passes.
///
/// `results` is drained between passes; `deferred` is filled by pass 1 and
/// consumed by pass 2; the counters accumulate across both.
#[derive(Default)]
struct PassState {
	results:           Mutex<Vec<FileSearchResult>>,
	deferred:          Mutex<Vec<tau_walker::FileCandidate>>,
	files_searched:    AtomicU64,
	skipped_oversized: AtomicU64,
	emitted:           AtomicU64,
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// Read one candidate per `policy` and search it, classifying the result.
fn search_one_file<M: Matcher + Sync>(
	worker: &mut SearchWorker,
	matcher: &M,
	file: &tau_walker::FileCandidate,
	file_params: SearchParams,
	policy: ReadPolicy,
) -> FileOutcome {
	let read = match policy {
		ReadPolicy::Full => {
			read_file_bytes_with_size(&file.path, file_size_hint(file.size), &mut worker.buffer)
		},
		ReadPolicy::Prefix => read_file_prefix(&file.path, &mut worker.buffer),
	};
	match read {
		Ok(ReadFile::Read) => {},
		Ok(ReadFile::Oversized) => return FileOutcome::Defer,
		Ok(ReadFile::Skipped) => {
			return match policy {
				ReadPolicy::Prefix => FileOutcome::SkippedOversized,
				ReadPolicy::Full => FileOutcome::Skipped,
			};
		},
		Err(_) => return FileOutcome::Skipped,
	}
	// A searcher error counts as searched-with-no-matches, matching the prior
	// behavior (the file was read and attempted).
	let search = search_file_bytes(&mut worker.searcher, matcher, &worker.buffer, file_params)
		.unwrap_or(SearchResultInternal {
			matches:       Vec::new(),
			match_count:   0,
			collected:     0,
			limit_reached: false,
		});
	FileOutcome::Searched(search)
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// Search one candidate and fold its outcome into the shared [`PassState`].
fn handle_file<M: Matcher + Sync>(
	file: &tau_walker::FileCandidate,
	worker: &mut SearchWorker,
	matcher: &M,
	file_params: SearchParams,
	policy: ReadPolicy,
	stop_after_matches: Option<u64>,
	state: &PassState,
	ct: &task::CancelToken,
) -> Result<()> {
	ct.heartbeat()?;
	if let Some(stop) = stop_after_matches
		&& state.emitted.load(Ordering::Relaxed) >= stop
	{
		return Ok(());
	}
	match search_one_file(worker, matcher, file, file_params, policy) {
		FileOutcome::Defer => {
			state.deferred.lock().push(file.clone());
		},
		FileOutcome::SkippedOversized => {
			state.skipped_oversized.fetch_add(1, Ordering::Relaxed);
		},
		FileOutcome::Skipped => {},
		FileOutcome::Searched(search) => {
			state.files_searched.fetch_add(1, Ordering::Relaxed);
			if search.match_count > 0 {
				let emitted_in_file = search.collected;
				state.results.lock().push(FileSearchResult {
					relative_path: file.relative.clone(),
					matches:       search.matches,
					match_count:   search.match_count,
					limit_reached: search.limit_reached,
				});
				if stop_after_matches.is_some() {
					state.emitted.fetch_add(emitted_in_file, Ordering::Relaxed);
				}
			}
		},
	}
	Ok(())
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// Run one search pass over `candidates`, returning its path-sorted results.
///
/// Counters and the deferred list accumulate into `state`; `results` is drained
/// here so the same state can drive a second pass.
fn run_pass<M: Matcher + Sync>(
	candidates: &[tau_walker::FileCandidate],
	matcher: &M,
	file_params: SearchParams,
	policy: ReadPolicy,
	parallel_allowed: bool,
	stop_after_matches: Option<u64>,
	state: &PassState,
	ct: &task::CancelToken,
) -> Result<Vec<FileSearchResult>> {
	if parallel_allowed && tau_walker::should_parallelize(candidates.len()) {
		tau_walker::execute_candidates_init(
			candidates,
			|| SearchWorker::new(file_params),
			|worker, file| {
				handle_file(file, worker, matcher, file_params, policy, stop_after_matches, state, ct)
			},
		)?;
	} else {
		let mut worker = SearchWorker::new(file_params);
		ct.heartbeat()?;
		for file in candidates {
			if let Some(stop) = stop_after_matches
				&& state.emitted.load(Ordering::Relaxed) >= stop
			{
				break;
			}
			handle_file(
				file,
				&mut worker,
				matcher,
				file_params,
				policy,
				stop_after_matches,
				state,
				ct,
			)?;
		}
	}
	let mut results = std::mem::take(&mut *state.results.lock());
	results.sort_unstable_by(|a, b| a.relative_path.cmp(&b.relative_path));
	Ok(results)
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// Search `candidates` in two passes: normal-sized files first, then oversized
/// files (mmap of their first [`MAX_FILE_BYTES`]) deferred to the end.
///
/// Deferring oversized files lets smaller files surface first and lets a
/// satisfied match budget skip the oversized pass entirely. Normal results
/// always precede oversized results; each group is path-sorted internally.
fn process_candidates<M: Matcher + Sync>(
	candidates: Vec<tau_walker::FileCandidate>,
	matcher: &M,
	params: SearchParams,
	parallel_allowed: bool,
	stop_after_matches: Option<u64>,
	ct: &task::CancelToken,
) -> Result<(Vec<FileSearchResult>, u64, u64)> {
	let file_params = per_file_params(params);
	let state = PassState::default();

	// Partition oversized-by-hint files out of pass 1 up front; files without a
	// size hint stay in pass 1 and are deferred at read time if oversized.
	let (normal, oversized_hinted): (Vec<_>, Vec<_>) =
		candidates
			.into_iter()
			.partition(|file| match file_size_hint(file.size) {
				Some(size) => size <= MAX_FILE_BYTES,
				None => true,
			});
	if !oversized_hinted.is_empty() {
		state.deferred.lock().extend(oversized_hinted);
	}

	let mut results = run_pass(
		&normal,
		matcher,
		file_params,
		ReadPolicy::Full,
		parallel_allowed,
		stop_after_matches,
		&state,
		ct,
	)?;

	// Pass 2: deferred oversized files, searched over their leading window —
	// only when a content-mode budget was not already satisfied in pass 1.
	let deferred = std::mem::take(&mut *state.deferred.lock());
	let limit_satisfied =
		stop_after_matches.is_some_and(|stop| state.emitted.load(Ordering::Relaxed) >= stop);
	if !deferred.is_empty() && !limit_satisfied {
		let oversized = run_pass(
			&deferred,
			matcher,
			file_params,
			ReadPolicy::Prefix,
			parallel_allowed,
			stop_after_matches,
			&state,
			ct,
		)?;
		results.extend(oversized);
	}

	Ok((
		results,
		state.skipped_oversized.load(Ordering::Relaxed),
		state.files_searched.load(Ordering::Relaxed),
	))
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
fn run_sequential_grep<M: Matcher + Sync>(
	search_path: &Path,
	matcher: &M,
	glob: Option<&str>,
	type_filter: Option<&TypeFilter>,
	params: SearchParams,
	include_hidden: bool,
	use_gitignore: bool,
	skip_node_modules: bool,
	ct: &task::CancelToken,
	stop_after_matches: Option<u64>,
) -> Result<(Vec<FileSearchResult>, u64, u64)> {
	let Some(candidates) = collect_grep_candidates(
		search_path,
		glob,
		type_filter,
		include_hidden,
		use_gitignore,
		skip_node_modules,
		tau_walker::WalkOrder::Path,
		ct,
	)?
	else {
		return Ok((Vec::new(), 0, 0));
	};
	process_candidates(candidates, matcher, params, false, stop_after_matches, ct)
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
#[allow(
	clippy::fn_params_excessive_bools,
	reason = "matches options structure of underlying walk candidates collector"
)]
fn run_parallel_streaming_grep<M: Matcher + Sync>(
	search_path: &Path,
	matcher: &M,
	glob: Option<&str>,
	type_filter: Option<&TypeFilter>,
	params: SearchParams,
	include_hidden: bool,
	use_gitignore: bool,
	skip_node_modules: bool,
	ct: &task::CancelToken,
) -> Result<(Vec<FileSearchResult>, u64, u64)> {
	let request = build_grep_walk_request(
		search_path,
		glob,
		include_hidden,
		use_gitignore,
		skip_node_modules,
		tau_walker::WalkOrder::Unordered,
	)?;
	let file_params = per_file_params(params);
	let state = PassState::default();

	request
		.for_each_file_candidate_parallel(
			|file| {
				if let Some(filter) = type_filter
					&& !matches_type_filter_str(&file.relative, filter)
				{
					return Ok(tau_walker::ParallelWalkControl::Continue);
				}
				with_parallel_grep_searcher(file_params, |searcher| {
					handle_file(file, searcher, matcher, file_params, ReadPolicy::Full, None, &state, ct)
				})?;
				Ok(tau_walker::ParallelWalkControl::Continue)
			},
			|| ct.heartbeat(),
		)
		.map_err(iofs::map_walker_error)?;

	let mut results = std::mem::take(&mut *state.results.lock());
	results.sort_unstable_by(|a, b| a.relative_path.cmp(&b.relative_path));

	let deferred = std::mem::take(&mut *state.deferred.lock());
	if !deferred.is_empty() {
		let oversized =
			run_pass(&deferred, matcher, file_params, ReadPolicy::Prefix, true, None, &state, ct)?;
		results.extend(oversized);
	}

	Ok((
		results,
		state.skipped_oversized.load(Ordering::Relaxed),
		state.files_searched.load(Ordering::Relaxed),
	))
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
fn flush_stream_window<M: Matcher + Sync>(
	window: &mut Vec<tau_walker::FileCandidate>,
	results: &mut Vec<FileSearchResult>,
	matcher: &M,
	file_params: SearchParams,
	state: &PassState,
	ct: &task::CancelToken,
	stop_after_matches: u64,
) -> Result<bool> {
	if window.is_empty() {
		return Ok(state.emitted.load(Ordering::Relaxed) >= stop_after_matches);
	}
	let window_results =
		run_pass(window.as_slice(), matcher, file_params, ReadPolicy::Full, true, None, state, ct)?;
	let emitted = emitted_content_matches(&window_results);
	let total_emitted = state
		.emitted
		.fetch_add(emitted, Ordering::Relaxed)
		.saturating_add(emitted);
	results.extend(window_results);
	window.clear();
	Ok(total_emitted >= stop_after_matches)
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
#[allow(
	clippy::fn_params_excessive_bools,
	reason = "matches options structure of underlying walk candidates collector"
)]
fn run_windowed_streaming_grep<M: Matcher + Sync>(
	search_path: &Path,
	matcher: &M,
	glob: Option<&str>,
	type_filter: Option<&TypeFilter>,
	params: SearchParams,
	include_hidden: bool,
	use_gitignore: bool,
	skip_node_modules: bool,
	ct: &task::CancelToken,
	stop_after_matches: u64,
) -> Result<(Vec<FileSearchResult>, u64, u64)> {
	let request = build_grep_walk_request(
		search_path,
		glob,
		include_hidden,
		use_gitignore,
		skip_node_modules,
		tau_walker::WalkOrder::Path,
	)?;
	let file_params = per_file_params(params);
	let state = PassState::default();
	let mut window = Vec::with_capacity(GREP_STREAM_WINDOW);
	let mut results = Vec::new();

	request
		.for_each_entry_with_heartbeat(
			|| ct.heartbeat(),
			|entry| {
				if let Some(filter) = type_filter
					&& !matches_type_filter_str(entry.relative_path, filter)
				{
					return Ok(tau_walker::WalkDecision::Include);
				}
				let relative = entry.relative_path.to_owned();
				window.push(tau_walker::FileCandidate {
					path: entry.absolute_path.into_owned(),
					relative,
					mtime: entry.mtime,
					size: entry.size,
				});
				if window.len() == GREP_STREAM_WINDOW
					&& flush_stream_window(
						&mut window,
						&mut results,
						matcher,
						file_params,
						&state,
						ct,
						stop_after_matches,
					)? {
					return Ok(tau_walker::WalkDecision::Stop);
				}
				Ok(tau_walker::WalkDecision::Include)
			},
			|_| Ok(tau_walker::WalkDecision::Include),
		)
		.map_err(iofs::map_walker_error)?;

	if state.emitted.load(Ordering::Relaxed) < stop_after_matches {
		flush_stream_window(
			&mut window,
			&mut results,
			matcher,
			file_params,
			&state,
			ct,
			stop_after_matches,
		)?;
	}

	let mut deferred = std::mem::take(&mut *state.deferred.lock());
	let limit_satisfied = state.emitted.load(Ordering::Relaxed) >= stop_after_matches;
	if !deferred.is_empty() && !limit_satisfied {
		deferred.sort_unstable_by(|a, b| a.relative.cmp(&b.relative));
		let oversized = run_pass(
			&deferred,
			matcher,
			file_params,
			ReadPolicy::Prefix,
			false,
			Some(stop_after_matches),
			&state,
			ct,
		)?;
		results.extend(oversized);
	}

	Ok((
		results,
		state.skipped_oversized.load(Ordering::Relaxed),
		state.files_searched.load(Ordering::Relaxed),
	))
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
fn run_streaming_grep<M: Matcher + Sync>(
	search_path: &Path,
	matcher: &M,
	glob: Option<&str>,
	type_filter: Option<&TypeFilter>,
	params: SearchParams,
	include_hidden: bool,
	use_gitignore: bool,
	skip_node_modules: bool,
	ct: &task::CancelToken,
) -> Result<(Vec<FileSearchResult>, u64, u64)> {
	let stop_after_matches = streaming_stop_after(params);
	match stop_after_matches {
		None => run_parallel_streaming_grep(
			search_path,
			matcher,
			glob,
			type_filter,
			params,
			include_hidden,
			use_gitignore,
			skip_node_modules,
			ct,
		),
		Some(stop) if stop <= ORDERED_STREAMING_STOP_MAX_COUNT || tau_walker::walk_workers() <= 1 => {
			run_sequential_grep(
				search_path,
				matcher,
				glob,
				type_filter,
				params,
				include_hidden,
				use_gitignore,
				skip_node_modules,
				ct,
				Some(stop),
			)
		},
		Some(stop) => run_windowed_streaming_grep(
			search_path,
			matcher,
			glob,
			type_filter,
			params,
			include_hidden,
			use_gitignore,
			skip_node_modules,
			ct,
			stop,
		),
	}
}

fn search_sync(content: &[u8], options: SearchOptions) -> SearchResult {
	let multiline = options.multiline.unwrap_or(false);
	let engine =
		match Engine::compile(&options.pattern, options.ignore_case.unwrap_or(false), multiline) {
			Ok(engine) => engine,
			Err(err) => return empty_search_result(Some(Error::from_reason(err).to_string())),
		};
	let (before, after) =
		resolve_context(options.context, options.context_before, options.context_after);
	let opts = pi_walker::grep::SearchOptions {
		multiline,
		mode: to_mode(options.mode),
		before,
		after,
		max_columns: options.max_columns.map(|value| value as usize),
		offset: options.offset.map_or(0, u64::from),
		max_count: options.max_count.map(u64::from),
	};
	match pi_walker::grep::search(&engine, content, &opts) {
		Ok(result) => SearchResult {
			matches:       result.matches.into_iter().map(Match::from).collect(),
			match_count:   clamp_u32(result.match_count),
			limit_reached: result.limit_reached,
			error:         None,
		},
		Err(err) => empty_search_result(Some(err)),
	}
}

/// Decoded [`GrepOptions`] that cross into the filesystem worker.
struct GrepRequest {
	pattern:            String,
	path:               String,
	ignore_case:        bool,
	multiline:          bool,
	glob:               Option<String>,
	exclude:            Vec<String>,
	recursive:          bool,
	file_type:          Option<String>,
	mode:               pi_walker::grep::Mode,
	before:             usize,
	after:              usize,
	max_columns:        Option<usize>,
	offset:             u64,
	max_count:          Option<u64>,
	max_count_per_file: Option<u64>,
	hidden:             bool,
	gitignore:          bool,
}

/// Forward each streamed batch to `onMatches`, awaiting the JS call so the
/// callback's pace back-pressures the search.
async fn forward_matches(
	callback: GrepStreamCallback,
	mut batches: mpsc::Receiver<Vec<pi_walker::grep::Match>>,
) -> Result<()> {
	// Per-file batches already queued ride along in one call, up to
	// `STREAM_BATCH` entries.
	let mut carry = None;
	while let Some(first) = match carry.take() {
		Some(batch) => Some(batch),
		None => batches.recv().await,
	} {
		let mut batch: Vec<GrepMatch> = first.into_iter().map(GrepMatch::from).collect();
		while let Ok(next) = batches.try_recv() {
			if batch.len() + next.len() > STREAM_BATCH {
				carry = Some(next);
				break;
			}
			batch.extend(next.into_iter().map(GrepMatch::from));
		}
		callback.call_async_catch(batch).await?;
	}
	Ok(())
}

async fn grep_async(
	filesystem: Fs,
	request: GrepRequest,
	stream: Option<GrepStreamCallback>,
	on_match: Option<ThreadsafeFunction<GrepMatch>>,
) -> Result<GrepResult> {
	let engine = Engine::compile(&request.pattern, request.ignore_case, request.multiline)
		.map_err(Error::from_reason)?;
	let root = pi_walker::fs::absolute(Path::new(&request.path))
		.map_err(|err| Error::from_reason(format!("Failed to resolve cwd: {err}")))?;
	let fs = pi_walker::Fs::new(&filesystem, &root);
	let (sink, batches) = match stream {
		Some(callback) => {
			let (sender, receiver) = mpsc::channel(GREP_STREAM_QUEUE);
			(Some(sender), Some((callback, receiver)))
		},
		None => (None, None),
	};
	let opts = pi_walker::grep::GrepOptions {
		multiline: request.multiline,
		glob: request.glob,
		recursive: request.recursive,
		exclude: request.exclude,
		file_type: request.file_type,
		mode: request.mode,
		before: request.before,
		after: request.after,
		max_columns: request.max_columns,
		offset: request.offset,
		max_count: request.max_count,
		max_count_per_file: request.max_count_per_file,
		walk: pi_walker::walk::Options {
			hidden: request.hidden,
			gitignore: request.gitignore,
			..Default::default()
		},
		sink,
		..pi_walker::grep::GrepOptions::new(Arc::new(engine))
	};
	let search = pi_walker::grep::grep(&fs, &root, opts);
	let result = match batches {
		Some((callback, receiver)) => {
			let (result, forwarded) = tokio::join!(search, forward_matches(callback, receiver));
			// A callback failure stops the search with a generic sink error; the
			// callback's own error is the one to report.
			forwarded?;
			result
		},
		None => search.await,
	}
	.map_err(|err| match err {
		pi_walker::grep::GrepError::Walk(err) => task::walk_failure(err),
		err => Error::from_reason(err.to_string()),
	})?;
	let matches: Vec<GrepMatch> = result.matches.into_iter().map(GrepMatch::from).collect();
	if let Some(callback) = on_match {
		for grep_match in &matches {
			callback.call(Ok(grep_match.clone()), ThreadsafeFunctionCallMode::NonBlocking);
		}
	}
	Ok(GrepResult {
		matches,
		total_matches: clamp_u32(result.total_matches),
		files_with_matches: clamp_u32(result.files_with_matches),
		files_searched: clamp_u32(result.files_searched),
		limit_reached: result.limit_reached.then_some(true),
		skipped_oversized: (result.skipped_oversized > 0)
			.then(|| clamp_u32(result.skipped_oversized)),
	})
}

// ---------------------------------------------------------------------------
// N-API exports
// ---------------------------------------------------------------------------

/// Search content for a pattern (one-shot, compiles pattern each time).
/// For repeated searches with the same pattern, use [`grep`] with file filters.
///
/// # Arguments
/// - `content`: `Uint8Array`/`Buffer` (zero-copy) or `string` (UTF-8).
/// - `options`: Regex settings, context, and output mode.
///
/// # Returns
/// Match list plus counts/limit status; errors are surfaced in `error`.
#[napi]
pub fn search(content: Either<JsString, Uint8Array>, options: SearchOptions) -> SearchResult {
	match &content {
		Either::A(js_str) => {
			let utf8 = match js_str.into_utf8() {
				Ok(utf8) => utf8,
				Err(err) => return empty_search_result(Some(err.to_string())),
			};
			search_sync(utf8.as_slice(), options)
		},
		Either::B(buf) => search_sync(buf.as_ref(), options),
	}
}

/// Quick check if content matches a pattern.
///
/// # Arguments
/// - `content`: `Uint8Array`/`Buffer` (zero-copy) or `string` (UTF-8).
/// - `pattern`: `Uint8Array`/`Buffer` (zero-copy) or `string` (UTF-8).
/// - `ignore_case`: Case-insensitive matching.
/// - `multiline`: Enable multiline regex mode.
///
/// # Returns
/// True if any match exists; false on no match.
#[napi]
pub fn has_match(
	content: Either<JsString, Uint8Array>,
	pattern: Either<JsString, Uint8Array>,
	ignore_case: Option<bool>,
	multiline: Option<bool>,
) -> Result<bool> {
	// Hold JsStringUtf8 on the stack and borrow - no copy
	let content_utf8;
	let content_slice: &[u8] = match &content {
		Either::A(js_str) => {
			content_utf8 = js_str.into_utf8()?;
			content_utf8.as_slice()
		},
		Either::B(buf) => buf.as_ref(),
	};

	let pattern_utf8;
	let pattern_string;
	let pattern_ref: &str = match &pattern {
		Either::A(js_str) => {
			pattern_utf8 = js_str.into_utf8()?;
			pattern_utf8.as_str()?
		},
		Either::B(buf) => {
			pattern_string = std::str::from_utf8(buf.as_ref())
				.map_err(|err| Error::from_reason(format!("Invalid UTF-8 in pattern: {err}")))?
				.to_owned();
			&pattern_string
		},
	};

	let engine =
		Engine::compile(pattern_ref, ignore_case.unwrap_or(false), multiline.unwrap_or(false))
			.map_err(Error::from_reason)?;
	Ok(engine.is_match(content_slice).unwrap_or(false))
}

/// Search files for a regex pattern.
///
/// # Arguments
/// - `options`: Pattern, path, filters, and output mode.
/// - `on_match`: Optional callback invoked per returned match/result, after the
///   search (never called when `options.onMatches` streams instead).
///
/// # Returns
/// Aggregated results across matching files.
#[napi]
pub fn grep<'env>(
	env: &'env Env,
	options: GrepOptions<'_>,
	#[napi(ts_arg_type = "((error: Error | null, match: GrepMatch) => void) | undefined | null")]
	on_match: Option<ThreadsafeFunction<GrepMatch>>,
) -> Result<PromiseRaw<'env, GrepResult>> {
	let GrepOptions {
		pattern,
		path,
		glob,
		exclude,
		recursive,
		r#type,
		ignore_case,
		multiline,
		hidden,
		gitignore,
		max_count,
		offset,
		context_before,
		context_after,
		context,
		max_columns,
		mode,
		max_count_per_file,
		timeout_ms,
		signal,
		filesystem,
		on_matches,
	} = options;

	let mode = to_mode(mode);
	let (before, after) = if mode == pi_walker::grep::Mode::Content {
		resolve_context(context, context_before, context_after)
	} else {
		(0, 0)
	};
	let request = GrepRequest {
		pattern,
		path,
		ignore_case: ignore_case.unwrap_or(false),
		multiline: multiline.unwrap_or(false),
		glob: glob
			.as_deref()
			.map(str::trim)
			.filter(|value| !value.is_empty())
			.map(str::to_owned),
		exclude: exclude.unwrap_or_default(),
		recursive: recursive.unwrap_or(true),
		file_type: r#type,
		mode,
		before,
		after,
		max_columns: max_columns.map(|value| value as usize),
		offset: offset.map_or(0, u64::from),
		max_count: max_count.map(u64::from),
		max_count_per_file: max_count_per_file.map(u64::from),
		hidden: hidden.unwrap_or(true),
		gitignore: gitignore.unwrap_or(true),
	};

	let ct = task::CancelToken::new(timeout_ms, signal);
	let filesystem = ShellFilesystem::resolve(filesystem);
	task::filesystem_future(env, "grep", ct, filesystem, move |filesystem| {
		grep_async(filesystem, request, on_matches, on_match)
	})
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
#[cfg(test)]
mod tests {
	#[cfg(unix)]
	use std::{ffi::CString, os::unix::ffi::OsStrExt};
	#[cfg(unix)]
	use std::{
		fs,
		path::{Path, PathBuf},
		sync::atomic::{AtomicU64, Ordering},
		time::{Duration, SystemTime, UNIX_EPOCH},
	};

	use grep_matcher::Matcher;

	#[cfg(unix)]
	use super::{GrepConfig, GrepOutputMode, grep_sync};
	use super::{escape_unescaped_parentheses, sanitize_braces};
	#[cfg(unix)]
	use crate::task;

	#[cfg(unix)]
	struct TempDirGuard(PathBuf);

	#[cfg(unix)]
	impl TempDirGuard {
		fn new() -> Self {
			static COUNTER: AtomicU64 = AtomicU64::new(0);
			let nanos = SystemTime::now()
				.duration_since(UNIX_EPOCH)
				.expect("system time is after UNIX_EPOCH")
				.as_nanos();
			let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
			let pid = std::process::id();
			let path = std::env::temp_dir().join(format!("tau-grep-test-{pid}-{nanos}-{seq}"));
			fs::create_dir_all(&path).expect("create temp test directory");
			Self(path)
		}

		fn path(&self) -> &Path {
			&self.0
		}
	}

	#[cfg(unix)]
	impl Drop for TempDirGuard {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.0);
		}
	}

	#[cfg(unix)]
	fn write_file(path: &Path, content: &str) {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).expect("create parent directories for test file");
		}
		fs::write(path, content).expect("write test file");
	}

	#[cfg(unix)]
	fn make_fifo(path: &Path) {
		let fifo_path =
			CString::new(path.as_os_str().as_bytes()).expect("fifo path has no NUL bytes");
		// SAFETY: `fifo_path` is a valid CString (NUL-terminated, no interior
		// NULs), so `as_ptr()` yields a valid C string pointer. `0o600` is a
		// valid mode. The CString is alive for the duration of the call.
		let rc = unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) };
		assert_eq!(rc, 0, "create fifo: {}", std::io::Error::last_os_error());
	}

	#[cfg(unix)]
	fn base_grep_config(path: &Path) -> GrepConfig {
		GrepConfig {
			pattern:            "needle".to_string(),
			path:               path.to_string_lossy().into_owned(),
			glob:               None,
			type_filter:        None,
			ignore_case:        None,
			multiline:          None,
			hidden:             None,
			gitignore:          Some(false),
			max_count:          None,
			offset:             None,
			context_before:     None,
			context_after:      None,
			context:            None,
			max_columns:        None,
			mode:               None,
			max_count_per_file: None,
		}
	}

	#[test]
	fn preserves_unicode_property_escapes() {
		assert_eq!(sanitize_braces(r"\p{Greek}").as_ref(), r"\p{Greek}");
	}

	#[test]
	fn preserves_hex_brace_escapes() {
		assert_eq!(sanitize_braces(r"\x{41}").as_ref(), r"\x{41}");
	}

	#[test]
	fn preserves_malformed_braced_escapes() {
		assert_eq!(sanitize_braces(r"\p{Greek").as_ref(), r"\p{Greek");
	}

	#[test]
	fn escapes_non_quantifier_braces() {
		assert_eq!(sanitize_braces("${platform}").as_ref(), "$\\{platform\\}");
	}

	#[test]
	fn preserves_valid_quantifiers() {
		assert_eq!(sanitize_braces("a{2,4}").as_ref(), "a{2,4}");
	}

	#[test]
	fn preserves_escaped_parentheses() {
		assert_eq!(escape_unescaped_parentheses(r"foo\(bar\)").as_ref(), r"foo\(bar\)");
	}

	#[test]
	fn escapes_literal_parentheses() {
		assert_eq!(
			escape_unescaped_parentheses("fetchAnthropicProvider(").as_ref(),
			r"fetchAnthropicProvider\("
		);
		assert_eq!(
			escape_unescaped_parentheses("fetchAnthropicProvider()").as_ref(),
			r"fetchAnthropicProvider\(\)"
		);
	}

	#[test]
	fn invalid_regex_falls_back_to_literal() {
		// Patterns that are not valid regex syntax (unclosed class, dangling
		// quantifier, stray `)`) must degrade to a literal search rather than
		// erroring.
		for (pattern, hay, miss) in [
			("foo[bar", &b"x foo[bar y"[..], &b"foobar"[..]),
			("+++", &b"a+++b"[..], &b"ab"[..]),
			("fail)", &b"(1 fail)"[..], &b"failure"[..]),
		] {
			let matcher = super::build_matcher(pattern, false, false)
				.unwrap_or_else(|e| panic!("`{pattern}` should fall back to literal, got: {e}"));
			assert!(matcher.is_match(hay).unwrap(), "`{pattern}` should match {hay:?}");
			assert!(!matcher.is_match(miss).unwrap(), "`{pattern}` should not match {miss:?}");
		}
	}

	#[test]
	fn stray_parenthesis_preserves_surrounding_regex() {
		// The targeted retry escapes the stray `(` but keeps `.*` as a regex.
		let matcher =
			super::build_matcher("foo.*(bar", false, false).expect("retry with escaped paren");
		assert!(matcher.is_match(b"fooXYZ(bar").unwrap());
		assert!(!matcher.is_match(b"foobar").unwrap());
	}

	#[test]
	fn valid_regex_is_not_escaped() {
		// A parseable pattern stays a regex: `fo+` matches repeats, which the
		// literal `fo+` never would.
		let matcher = super::build_matcher("fo+", false, false).expect("valid regex");
		assert!(matcher.is_match(b"foooo").unwrap());
		assert!(!matcher.is_match(b"bar").unwrap());
	}

	#[cfg(unix)]
	#[test]
	fn grep_supports_pcre2_lookaround_and_backreferences() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("lookahead.txt"), "foobar\nfoobaz\n");
		write_file(&root.path().join("backreference.txt"), "same same\nsame other\n");
		write_file(&root.path().join("models.txt"), "dim_customers_status_accepted_values\n");

		for (pattern, path, line) in [
			(r"foo(?=bar)", "lookahead.txt", "foobar"),
			(r"\b(\w+)\s+\1\b", "backreference.txt", "same same"),
			(
				r"(final_incremental_account_id_relationships|dim_customers_status_accepted_values|stg_orders_customer_id_relationships)(?!_[0-9a-f]{32})",
				"models.txt",
				"dim_customers_status_accepted_values",
			),
		] {
			let mut config = base_grep_config(root.path());
			config.pattern = pattern.to_string();
			let result = grep_sync(config, None, task::CancelToken::default())
				.unwrap_or_else(|err| panic!("`{pattern}` should search with PCRE2: {err}"));

			assert_eq!(result.total_matches, 1, "`{pattern}` should match once");
			assert_eq!(result.matches.len(), 1, "`{pattern}` should return one match");
			assert_eq!(result.matches[0].path, path);
			assert_eq!(result.matches[0].line_number, 1);
			assert_eq!(result.matches[0].line, line);
		}
	}

	#[cfg(unix)]
	#[test]
	fn grep_supports_multiline_pcre2_backreferences_and_lookahead() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("schema.yml"), "  - not_null:\n      severity: warn\n");

		let mut config = base_grep_config(root.path());
		config.pattern = r"^(\s+)- (not_null|unique|accepted_values|relationships|expression_is_true|[a-z_]+):\s*$\n(?!\1    (arguments|config|description|name):)".to_string();
		config.multiline = Some(true);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("multiline PCRE2 pattern should search without terminating the process");

		assert_eq!(result.total_matches, 1);
		assert_eq!(result.matches.len(), 1);
		assert_eq!(result.matches[0].path, "schema.yml");
		assert_eq!(result.matches[0].line_number, 1);
	}
	#[cfg(unix)]
	#[test]
	fn grep_directory_skips_fifo_entries() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("regular.txt"), "needle\n");
		make_fifo(&root.path().join("skip-me.fifo"));

		let result = grep_sync(base_grep_config(root.path()), None, task::CancelToken::default())
			.expect("directory grep should succeed");

		assert_eq!(result.total_matches, 1);
		assert_eq!(result.files_with_matches, 1);
		assert_eq!(result.files_searched, 1);
		assert_eq!(result.matches.len(), 1);
		assert_eq!(result.matches[0].path, "regular.txt");
	}

	#[cfg(unix)]
	#[test]
	fn grep_directory_counts_searched_files_without_storing_no_match_results() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("a.txt"), "needle\n");
		write_file(&root.path().join("b.txt"), "haystack\n");

		let result = grep_sync(base_grep_config(root.path()), None, task::CancelToken::default())
			.expect("directory grep should succeed");

		assert_eq!(result.total_matches, 1);
		assert_eq!(result.files_with_matches, 1);
		assert_eq!(result.files_searched, 2);
		assert_eq!(result.matches.len(), 1);
		assert_eq!(result.matches[0].path, "a.txt");
	}

	#[cfg(unix)]
	#[test]
	fn grep_sync_with_gitignore_skips_ignored_rs_files() {
		let root = TempDirGuard::new();
		fs::create_dir_all(root.path().join(".git")).expect("create repo marker");
		fs::write(root.path().join(".gitignore"), "ignored.rs\nignored-dir/\n")
			.expect("write gitignore");
		write_file(&root.path().join("kept.rs"), "needle kept\n");
		write_file(&root.path().join("ignored.rs"), "needle ignored\n");
		write_file(&root.path().join("ignored-dir/nested.rs"), "needle nested\n");

		let mut config = base_grep_config(root.path());
		config.gitignore = Some(true);
		config.glob = Some("*.rs".to_string());

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("gitignore-aware grep should succeed");

		assert_eq!(result.total_matches, 1);
		assert_eq!(result.files_with_matches, 1);
		assert_eq!(result.files_searched, 1);
		assert_eq!(result.matches.len(), 1);
		assert_eq!(result.matches[0].path, "kept.rs");
		assert_eq!(result.matches[0].line, "needle kept");
	}

	#[cfg(unix)]
	#[test]
	fn grep_files_with_matches_counts_all_searched_files_when_none_match() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("a.txt"), "haystack a\n");
		write_file(&root.path().join("b.txt"), "haystack b\n");

		let mut config = base_grep_config(root.path());
		config.mode = Some(GrepOutputMode::FilesWithMatches);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("directory grep should succeed");

		assert_eq!(result.total_matches, 0);
		assert_eq!(result.files_with_matches, 0);
		assert_eq!(result.files_searched, 2);
		assert!(result.matches.is_empty());
	}

	#[cfg(unix)]
	#[test]
	fn grep_directory_applies_offset_and_limit_in_walker_order() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("a.txt"), "needle a1\nneedle a2\n");
		write_file(&root.path().join("b.txt"), "needle b1\n");
		write_file(&root.path().join("c.txt"), "haystack\n");

		let mut config = base_grep_config(root.path());
		config.max_count = Some(2);
		config.offset = Some(1);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("directory grep should succeed");

		assert_eq!(result.total_matches, 3);
		assert_eq!(result.files_with_matches, 2);
		assert_eq!(result.limit_reached, Some(true));
		assert_eq!(result.matches.len(), 2);
		assert_eq!(result.matches[0].path, "a.txt");
		assert_eq!(result.matches[0].line, "needle a2");
		assert_eq!(result.matches[1].path, "b.txt");
		assert_eq!(result.matches[1].line, "needle b1");
	}

	#[cfg(unix)]
	#[test]
	fn grep_count_mode_limit_applies_to_matches_not_files() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("a.txt"), "needle a1\nneedle a2\n");
		write_file(&root.path().join("b.txt"), "needle b1\n");

		let mut config = base_grep_config(root.path());
		config.mode = Some(GrepOutputMode::Count);
		config.max_count = Some(2);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("directory grep should succeed");

		assert_eq!(result.total_matches, 3);
		assert_eq!(result.files_with_matches, 2);
		assert_eq!(result.limit_reached, Some(true));
		assert_eq!(result.matches.len(), 1);
		assert_eq!(result.matches[0].path, "a.txt");
		assert_eq!(result.matches[0].match_count, Some(2));
	}

	#[cfg(unix)]
	#[test]
	fn grep_streaming_respects_pre_cancelled_token() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("regular.txt"), "needle\n");

		let ct = task::CancelToken::new(Some(0), None);
		std::thread::sleep(Duration::from_millis(1));
		let result = grep_sync(base_grep_config(root.path()), None, ct);

		let Err(err) = result else {
			panic!("pre-cancelled grep should fail before returning matches");
		};
		assert!(
			err.to_string().contains("Timeout"),
			"expected timeout cancellation error, got: {err}"
		);
	}

	#[cfg(unix)]
	#[test]
	fn grep_special_root_path_returns_empty_result() {
		let root = TempDirGuard::new();
		let fifo = root.path().join("direct.fifo");
		make_fifo(&fifo);

		let result = grep_sync(base_grep_config(&fifo), None, task::CancelToken::default())
			.expect("special-file grep should return an empty result");

		assert!(result.matches.is_empty());
		assert_eq!(result.total_matches, 0);
		assert_eq!(result.files_with_matches, 0);
		assert_eq!(result.files_searched, 0);
		assert_eq!(result.limit_reached, None);
	}

	#[cfg(unix)]
	#[test]
	fn grep_multiline_matches_cross_line_patterns() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("code.txt"), "fn foo() {\n  return 1;\n}\n");

		let mut config = base_grep_config(root.path());
		config.pattern = r"foo\(\) \{\n  return".to_string();
		config.multiline = Some(true);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("multiline grep should succeed");

		assert_eq!(result.total_matches, 1, "cross-line pattern should match across lines");
		assert_eq!(result.matches.len(), 1);
		assert_eq!(result.matches[0].path, "code.txt");
		assert_eq!(result.matches[0].line_number, 1);
	}

	#[cfg(unix)]
	#[test]
	fn grep_per_file_max_count_preserves_file_diversity() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("a.txt"), "needle 1\nneedle 2\nneedle 3\nneedle 4\nneedle 5\n");
		write_file(&root.path().join("z.txt"), "needle z\n");

		let mut config = base_grep_config(root.path());
		config.max_count = Some(4);
		config.max_count_per_file = Some(2);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("directory grep should succeed");

		let paths: Vec<&str> = result
			.matches
			.iter()
			.map(|matched| matched.path.as_str())
			.collect();
		assert_eq!(paths, ["a.txt", "a.txt", "z.txt"], "hot file must not starve later files");
		assert_eq!(result.files_with_matches, 2);
		assert_eq!(result.limit_reached, Some(true));
	}

	#[cfg(unix)]
	fn content_search_params(
		max_count: u64,
		max_count_per_file: Option<u64>,
	) -> super::SearchParams {
		super::SearchParams {
			context_before: 0,
			context_after: 0,
			max_columns: None,
			mode: super::OutputMode::Content,
			max_count: Some(max_count),
			max_count_per_file,
			offset: 0,
			multiline: false,
		}
	}

	#[cfg(unix)]
	fn unlimited_params(mode: super::OutputMode, context: u32) -> super::SearchParams {
		super::SearchParams {
			context_before: context,
			context_after: context,
			max_columns: None,
			mode,
			max_count: None,
			max_count_per_file: None,
			offset: 0,
			multiline: false,
		}
	}

	#[cfg(unix)]
	#[derive(Debug, PartialEq, Eq)]
	struct MatchSnapshot {
		line_number:    u64,
		line:           String,
		context_before: Vec<(u32, String)>,
		context_after:  Vec<(u32, String)>,
	}

	#[cfg(unix)]
	#[derive(Debug, PartialEq, Eq)]
	struct FileSnapshot {
		relative_path: String,
		match_count:   u64,
		limit_reached: bool,
		matches:       Vec<MatchSnapshot>,
	}

	#[cfg(unix)]
	fn file_snapshots(results: &[super::FileSearchResult]) -> Vec<FileSnapshot> {
		results
			.iter()
			.map(|result| FileSnapshot {
				relative_path: result.relative_path.clone(),
				match_count:   result.match_count,
				limit_reached: result.limit_reached,
				matches:       result
					.matches
					.iter()
					.map(|matched| MatchSnapshot {
						line_number:    matched.line_number,
						line:           matched.line.clone(),
						context_before: matched
							.context_before
							.iter()
							.map(|line| (line.line_number, line.line.clone()))
							.collect(),
						context_after:  matched
							.context_after
							.iter()
							.map(|line| (line.line_number, line.line.clone()))
							.collect(),
					})
					.collect(),
			})
			.collect()
	}

	#[cfg(unix)]
	#[derive(Debug, PartialEq, Eq)]
	struct GrepMatchSnapshot {
		path:        String,
		line_number: u32,
		line:        String,
		match_count: Option<u32>,
	}

	#[cfg(unix)]
	fn grep_match_snapshots(matches: &[super::GrepMatch]) -> Vec<GrepMatchSnapshot> {
		matches
			.iter()
			.map(|matched| GrepMatchSnapshot {
				path:        matched.path.clone(),
				line_number: matched.line_number,
				line:        matched.line.clone(),
				match_count: matched.match_count,
			})
			.collect()
	}

	#[cfg(unix)]
	fn populate_parallel_parity_tree(root: &Path) {
		fs::create_dir_all(root.join(".git")).expect("create repo marker");
		write_file(&root.join("dir_00/.gitignore"), "ignored_match.txt\n");
		write_file(
			&root.join("dir_00/ignored_match.txt"),
			"before ignored\nneedle ignored\nafter ignored\n",
		);

		for index in 0..300 {
			let path =
				root.join(format!("dir_{:02}/nested_{:02}/file_{index:03}.txt", index % 12, index % 5));
			let content = if index % 3 == 0 {
				format!("before {index}\nneedle {index}\nafter {index}\n")
			} else {
				format!("before {index}\nhaystack {index}\nafter {index}\n")
			};
			write_file(&path, &content);
		}
	}

	#[cfg(unix)]
	fn sequential_reference_result(root: &Path, params: super::SearchParams) -> super::GrepResult {
		let matcher = super::build_matcher("needle", false, false).expect("build test matcher");
		let (results, skipped_oversized, files_searched) = super::run_sequential_grep(
			root,
			&matcher,
			None,
			None,
			params,
			true,
			true,
			true,
			&task::CancelToken::default(),
			super::streaming_stop_after(params),
		)
		.expect("sequential grep should succeed");
		let (matches, total_matches, files_with_matches, files_searched, limit_reached) =
			super::aggregate_parallel_results(results, params, files_searched);

		super::GrepResult {
			matches,
			total_matches: crate::utils::clamp_u32(total_matches),
			files_with_matches,
			files_searched,
			limit_reached: limit_reached.then_some(true),
			skipped_oversized: (skipped_oversized > 0)
				.then(|| crate::utils::clamp_u32(skipped_oversized)),
		}
	}

	#[cfg(unix)]
	fn assert_same_grep_result(actual: &super::GrepResult, expected: &super::GrepResult) {
		assert_eq!(actual.total_matches, expected.total_matches);
		assert_eq!(actual.files_with_matches, expected.files_with_matches);
		assert_eq!(actual.files_searched, expected.files_searched);
		assert_eq!(actual.limit_reached, expected.limit_reached);
		assert_eq!(actual.skipped_oversized, expected.skipped_oversized);
		assert_eq!(grep_match_snapshots(&actual.matches), grep_match_snapshots(&expected.matches));
	}

	#[cfg(unix)]
	#[test]
	fn parallel_streaming_content_matches_sequential_with_context_and_gitignore() {
		let root = TempDirGuard::new();
		populate_parallel_parity_tree(root.path());
		let matcher = super::build_matcher("needle", false, false).expect("build test matcher");
		let params = unlimited_params(super::OutputMode::Content, 1);

		let parallel = super::run_streaming_grep(
			root.path(),
			&matcher,
			None,
			None,
			params,
			true,
			true,
			true,
			&task::CancelToken::default(),
		)
		.expect("parallel streaming grep should succeed");
		let sequential = super::run_sequential_grep(
			root.path(),
			&matcher,
			None,
			None,
			params,
			true,
			true,
			true,
			&task::CancelToken::default(),
			None,
		)
		.expect("sequential grep should succeed");

		assert_eq!(parallel.1, sequential.1, "oversized skip counts must match");
		assert_eq!(parallel.2, sequential.2, "searched file counts must match");
		assert_eq!(file_snapshots(&parallel.0), file_snapshots(&sequential.0));
	}

	#[cfg(unix)]
	#[test]
	fn parallel_streaming_count_and_files_modes_match_sequential_reference() {
		let root = TempDirGuard::new();
		populate_parallel_parity_tree(root.path());

		for (mode, output_mode) in [
			(super::OutputMode::Count, GrepOutputMode::Count),
			(super::OutputMode::FilesWithMatches, GrepOutputMode::FilesWithMatches),
		] {
			let mut config = base_grep_config(root.path());
			config.gitignore = Some(true);
			config.mode = Some(output_mode);

			let actual = grep_sync(config, None, task::CancelToken::default())
				.expect("parallel grep should succeed");
			let expected = sequential_reference_result(root.path(), unlimited_params(mode, 0));

			assert_same_grep_result(&actual, &expected);
		}
	}

	#[cfg(unix)]
	#[test]
	fn parallel_streaming_type_filter_limits_search_to_matching_extensions() {
		let root = TempDirGuard::new();
		let mut expected = Vec::new();
		for index in 0..150 {
			let source = format!("dir_{:02}/source_{index:03}.rs", index % 6);
			expected.push(source.clone());
			write_file(&root.path().join(&source), "needle\n");
			write_file(
				&root
					.path()
					.join(format!("dir_{:02}/note_{index:03}.txt", index % 6)),
				"needle\n",
			);
		}
		expected.sort_unstable();

		let mut config = base_grep_config(root.path());
		config.type_filter = Some("rs".to_string());

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("parallel grep should succeed");
		let paths: Vec<&str> = result
			.matches
			.iter()
			.map(|matched| matched.path.as_str())
			.collect();

		assert_eq!(paths, expected);
		assert_eq!(result.files_searched, 150);
		assert_eq!(result.files_with_matches, 150);
	}

	#[cfg(unix)]
	#[test]
	fn parallel_streaming_large_budget_stops_walking_before_scanning_tree() {
		let root = TempDirGuard::new();
		let file_count = 3_000;
		for index in 0..file_count {
			write_file(&root.path().join(format!("{index:04}.txt")), "needle\n");
		}

		let mut config = base_grep_config(root.path());
		config.max_count = Some(100);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("parallel grep should succeed");

		assert_eq!(result.limit_reached, Some(true));
		assert_eq!(result.matches.len(), 100);
		for (index, matched) in result.matches.iter().enumerate() {
			assert_eq!(matched.path, format!("{index:04}.txt"));
		}
		assert!(
			result.files_searched < file_count / 2,
			"expected budget to stop the walk, scanned {} of {file_count} files",
			result.files_searched,
		);
	}
	#[cfg(unix)]
	#[test]
	fn parallel_streaming_defers_oversized_results_until_after_normal_results() {
		let root = TempDirGuard::new();
		write_oversized_file(&root.path().join("000_big.txt"), "needle big 0\n");
		write_oversized_file(&root.path().join("001_big.txt"), "needle big 1\n");
		for index in 0..300 {
			write_file(&root.path().join(format!("normal/file_{index:03}.txt")), "needle normal\n");
		}

		let result = grep_sync(base_grep_config(root.path()), None, task::CancelToken::default())
			.expect("parallel grep should succeed");
		let paths: Vec<&str> = result
			.matches
			.iter()
			.map(|matched| matched.path.as_str())
			.collect();

		assert_eq!(paths.len(), 302);
		assert!(paths[..300].iter().all(|path| path.starts_with("normal/")));
		assert_eq!(paths[300..], ["000_big.txt", "001_big.txt"]);
		assert_eq!(result.files_searched, 302);
	}

	#[cfg(unix)]
	#[test]
	fn parallel_streaming_respects_cancelled_token_mid_walk() {
		let root = TempDirGuard::new();
		for index in 0..1_000 {
			write_file(&root.path().join(format!("{index:04}.txt")), "needle\n");
		}

		let ct = task::CancelToken::new(Some(1), None);
		std::thread::sleep(Duration::from_millis(5));
		let result = grep_sync(base_grep_config(root.path()), None, ct);

		let Err(err) = result else {
			panic!("cancelled parallel grep should fail before returning matches");
		};
		assert!(
			err.to_string().contains("Timeout"),
			"expected timeout cancellation error, got: {err}"
		);
	}

	#[cfg(unix)]
	#[test]
	fn streaming_grep_stops_after_first_page_content_budget() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("a.txt"), "needle a1\nneedle a2\n");
		write_file(&root.path().join("z.txt"), "needle z\n");
		let matcher = super::build_matcher("needle", false, false).expect("build test matcher");
		let params = content_search_params(1, None);

		let (results, skipped_oversized, files_searched) = super::run_streaming_grep(
			root.path(),
			&matcher,
			None,
			None,
			params,
			true,
			false,
			true,
			&task::CancelToken::default(),
		)
		.expect("streaming grep should succeed");

		assert_eq!(skipped_oversized, 0);
		assert_eq!(files_searched, 1);
		assert_eq!(results.len(), 1);
		assert_eq!(results[0].matches.len(), 1);
		assert_eq!(results[0].relative_path, "a.txt");
	}

	#[cfg(unix)]
	#[test]
	fn streaming_grep_budget_counts_returned_matches_under_per_file_cap() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("a.txt"), "needle a1\nneedle a2\n");
		write_file(&root.path().join("b.txt"), "needle b1\nneedle b2\n");
		write_file(&root.path().join("c.txt"), "needle c1\nneedle c2\n");
		let matcher = super::build_matcher("needle", false, false).expect("build test matcher");
		let params = content_search_params(3, Some(1));

		let (results, skipped_oversized, files_searched) = super::run_streaming_grep(
			root.path(),
			&matcher,
			None,
			None,
			params,
			true,
			false,
			true,
			&task::CancelToken::default(),
		)
		.expect("streaming grep should succeed");

		assert_eq!(skipped_oversized, 0);
		assert_eq!(files_searched, 3);
		assert_eq!(results.len(), 3);
		assert_eq!(
			results
				.iter()
				.map(|result| result.matches.len())
				.sum::<usize>(),
			3
		);
	}

	#[cfg(unix)]
	#[test]
	fn streaming_grep_quits_parallel_after_large_budget() {
		let root = TempDirGuard::new();
		let budget = super::ORDERED_STREAMING_STOP_MAX_COUNT + 1;
		let file_count = super::GREP_STREAM_WINDOW * 3;
		let expected_paths: Vec<String> = (0..file_count)
			.map(|index| format!("{index:05}.txt"))
			.collect();
		for path in &expected_paths {
			write_file(&root.path().join(path), "needle\n");
		}
		let matcher = super::build_matcher("needle", false, false).expect("build test matcher");
		let params = content_search_params(budget, None);

		let (results, skipped_oversized, files_searched) = super::run_streaming_grep(
			root.path(),
			&matcher,
			None,
			None,
			params,
			true,
			false,
			true,
			&task::CancelToken::default(),
		)
		.expect("streaming grep should succeed");

		let result_paths: Vec<&str> = results
			.iter()
			.map(|result| result.relative_path.as_str())
			.collect();
		let expected_prefix: Vec<&str> = expected_paths
			.iter()
			.take(result_paths.len())
			.map(String::as_str)
			.collect();
		let searched_bound = u64::try_from(file_count / 2).unwrap_or(u64::MAX);
		let file_count = u64::try_from(file_count).unwrap_or(u64::MAX);

		assert_eq!(skipped_oversized, 0);
		assert_eq!(result_paths.first().copied(), Some("00000.txt"));
		assert_eq!(result_paths, expected_prefix, "results must be a path-ordered prefix");
		assert!(
			files_searched < searched_bound,
			"expected budget to bound work, searched {files_searched} of {file_count} files",
		);
		assert!(
			files_searched >= budget,
			"early stop must search enough files to satisfy the match budget",
		);
		assert!(files_searched < file_count, "early stop must avoid scanning the whole tree");
	}

	#[cfg(unix)]
	fn write_oversized_file(path: &Path, prefix: &str) {
		// Exceed MAX_FILE_BYTES (4 MiB) so the file is routed to the deferred
		// prefix pass. `prefix` lands at the start, inside the searched window.
		let mut content = String::with_capacity(5 * 1024 * 1024 + prefix.len());
		content.push_str(prefix);
		while content.len() <= (super::MAX_FILE_BYTES as usize) + 256 * 1024 {
			content.push_str("filler line of haystack text\n");
		}
		write_file(path, &content);
	}

	#[cfg(unix)]
	fn populate_windowed_oversized_tree(root: &Path) -> Vec<String> {
		write_oversized_file(&root.join("00_big.txt"), "needle\n");
		let mut normal_paths = Vec::new();
		for index in 0..70 {
			let relative = format!("01_normal_{index:02}.txt");
			write_file(&root.join(&relative), "needle\n");
			normal_paths.push(relative);
		}
		normal_paths
	}

	#[cfg(unix)]
	#[test]
	fn windowed_streaming_skips_oversized_when_normal_matches_satisfy_budget() {
		let root = TempDirGuard::new();
		let normal_paths = populate_windowed_oversized_tree(root.path());
		let mut config = base_grep_config(root.path());
		config.max_count = Some(65);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("windowed grep should succeed");
		let paths: Vec<&str> = result
			.matches
			.iter()
			.map(|matched| matched.path.as_str())
			.collect();
		let expected: Vec<&str> = normal_paths.iter().take(65).map(String::as_str).collect();

		assert_eq!(paths.len(), 65);
		assert!(!paths.contains(&"00_big.txt"));
		assert_eq!(paths, expected, "returned matches must be the normal-file path prefix");
		assert_eq!(
			result.files_searched, 70,
			"oversized file must remain deferred and unsearched once normal files satisfy the budget",
		);
	}

	#[cfg(unix)]
	#[test]
	fn windowed_streaming_emits_deferred_oversized_after_normals_when_budget_remains() {
		let root = TempDirGuard::new();
		let normal_paths = populate_windowed_oversized_tree(root.path());
		let mut config = base_grep_config(root.path());
		config.max_count = Some(100);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("windowed grep should succeed");
		let paths: Vec<&str> = result
			.matches
			.iter()
			.map(|matched| matched.path.as_str())
			.collect();
		let expected_normals: Vec<&str> = normal_paths.iter().map(String::as_str).collect();

		assert_eq!(paths.len(), 71);
		assert_eq!(paths[..70], expected_normals);
		assert_eq!(paths.last().copied(), Some("00_big.txt"));
		assert_eq!(result.files_searched, 71);
	}

	#[cfg(unix)]
	#[test]
	fn oversized_file_is_searched_over_its_prefix_window() {
		let root = TempDirGuard::new();
		write_oversized_file(&root.path().join("big.txt"), "needle\n");

		let result = grep_sync(base_grep_config(root.path()), None, task::CancelToken::default())
			.expect("directory grep should succeed");

		// Match in the leading window is found; the file is counted as searched,
		// not skipped.
		assert_eq!(result.total_matches, 1);
		assert_eq!(result.files_with_matches, 1);
		assert_eq!(result.files_searched, 1);
		assert_eq!(result.skipped_oversized, None);
		assert_eq!(result.matches[0].path, "big.txt");
	}

	#[cfg(unix)]
	#[test]
	fn oversized_prefix_read_returns_stable_snapshot_after_rewrite() {
		let root = TempDirGuard::new();
		let path = root.path().join("big.txt");
		let prefix_len = usize::try_from(super::MAX_FILE_BYTES).expect("MAX_FILE_BYTES fits usize");
		let oversized_len = prefix_len + 1024;
		fs::write(&path, vec![b'a'; oversized_len]).expect("write original oversized file");

		let mut buffer = Vec::new();
		let outcome = super::read_file_prefix(&path, &mut buffer).expect("read oversized prefix");
		assert!(matches!(outcome, super::ReadFile::Read));
		assert_eq!(buffer.len(), prefix_len);

		fs::write(&path, vec![b'b'; oversized_len]).expect("rewrite backing file");

		assert!(
			buffer.iter().all(|&byte| byte == b'a'),
			"captured prefix must remain the original bytes after the backing file is rewritten",
		);
	}

	#[cfg(unix)]
	#[test]
	fn oversized_results_follow_normal_results_regardless_of_path_order() {
		let root = TempDirGuard::new();
		// `a_big.txt` sorts before `z_small.txt` lexically, but as an oversized
		// file it must still be emitted after the normal-sized file.
		write_oversized_file(&root.path().join("a_big.txt"), "needle\n");
		write_file(&root.path().join("z_small.txt"), "needle\n");

		let result = grep_sync(base_grep_config(root.path()), None, task::CancelToken::default())
			.expect("directory grep should succeed");

		let paths: Vec<&str> = result.matches.iter().map(|m| m.path.as_str()).collect();
		assert_eq!(paths, ["z_small.txt", "a_big.txt"], "normal files precede oversized");
		assert_eq!(result.files_searched, 2);
	}

	#[cfg(unix)]
	#[test]
	fn oversized_pass_skipped_when_budget_satisfied_by_normal_files() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("small.txt"), "needle\n");
		write_oversized_file(&root.path().join("big.txt"), "needle\n");

		// Content mode with a budget of 1 is satisfied by the normal file; the
		// deferred oversized file must never be read (it would add a match).
		let mut config = base_grep_config(root.path());
		config.max_count = Some(1);

		let result = grep_sync(config, None, task::CancelToken::default())
			.expect("directory grep should succeed");

		assert_eq!(result.total_matches, 1, "oversized file must not be searched");
		assert_eq!(result.files_searched, 1);
		assert_eq!(result.matches[0].path, "small.txt");
		assert_eq!(result.limit_reached, Some(true));
	}

	#[cfg(unix)]
	#[test]
	fn single_oversized_target_searches_prefix() {
		let root = TempDirGuard::new();
		let big = root.path().join("big.txt");
		write_oversized_file(&big, "needle\n");

		let result = grep_sync(base_grep_config(&big), None, task::CancelToken::default())
			.expect("single-file grep should succeed");

		assert_eq!(result.total_matches, 1);
		assert_eq!(result.files_searched, 1);
		assert_eq!(result.skipped_oversized, None);
	}
}
