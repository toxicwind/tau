//! Parallel filesystem walking, globbing, and content search.
//!
//! One stack serves every tool that lists or searches files: the agent's
//! `glob`/`grep`/`search` natives, ast-grep discovery, fuzzy find, workspace
//! listing, and the embedded shell's `rg`, `grep`, `fd`, and `find`.
//!
//! - [`fs`]: the filesystem layer. [`Fs::Native`] reads the host through
//!   per-platform syscall fast paths (relative `openat` opens, bulk directory
//!   reads, no per-entry `stat` for minimal listings); [`Fs::Provider`] awaits
//!   any async [`pi_vfs::Fs`] provider, including `scheme://` URL roots.
//! - [`pattern`]: glob compilation with `globset` literal-separator semantics
//!   plus the pruning queries a walker needs.
//! - [`ignore`]: gitignore-format rules and the `.ignore`/`.gitignore`/
//!   `.git/info/exclude`/global-excludes chain.
//! - [`walk`]: the async parallel walker ([`walk::walk`], [`walk::collect`]),
//!   the listing cache, and the serial ordered traversal cursor
//!   ([`walk::Tree`]).
//! - [`glob`]: path selection in pi's glob dialect and the glob search.
//! - [`grep`]: pattern compilation in pi's regex dialect, buffer scanning, and
//!   the directory/file content search.
//!
//! Walker futures spawn their tasks on the current tokio runtime (a
//! multi-thread runtime keeps them parallel); dropping a future cancels its
//! work.
//!
//! # Example
//! ```ignore
//! use pi_walker::{Fs, walk};
//!
//! let root = std::path::Path::new("/repo");
//! let opts = walk::Options { gitignore: true, skip_git: true, ..Default::default() };
//! let files = walk::collect(&Fs::native(), root, &opts, true, |_, e| {
//!     if e.file_type == pi_walker::FileType::File { walk::Action::Continue } else { walk::Action::Skip }
//! })
//! .await?;
//! for entry in files.iter() {
//!     println!("{}", entry.path_lossy());
//! }
//! ```

pub mod exec;
pub mod fs;
pub mod glob;
pub mod grep;
pub mod ignore;
pub mod pattern;
#[cfg(test)]
mod testing;
pub mod walk;

// refused_by: modify_delete_guard · collision: none (no common ancestor text)
//! Reusable platform directory traversal primitives.
//!
//! # Overview
//! `tau-walker` owns the native directory-read fast path that higher-level
//! tools use for globbing, grep candidate discovery, AST scans, and shell
//! builtins. The crate exposes plain Rust types, visitor interfaces, cache
//! policy, and a caller-supplied heartbeat so consumers do not inherit N-API
//! dependencies.

mod cache;
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/// High-level entry filter applied by collection and streaming APIs.
#[derive(Clone)]
pub struct WalkFilter {
	kind: WalkFilterKind,
	max_file_size: Option<u64>,
	skip_node_modules_unless_seen: bool,
	mentions_node_modules: bool,
	glob: Option<CompiledWalkGlob>,
	/// Exclusion globs (2026-11-02, upstream-parity): entries NOT matched, even
	/// when the positive `glob` selects them. Pattern semantics mirror upstream
	/// can1357/oh-my-pi `pi_natives::grep`: a pattern without `/` matches at any
	/// depth (`*.test.ts`, `vendor`); a leading `/` anchors it to the walk root
	/// (`/vendor`); a matched directory is not entered. Compiled with the same
	/// `literal_separator` rule as the positive glob.
	exclude: Option<CompiledWalkGlob>,
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
impl WalkFilter {
	/// Return a filter that accepts files and directories.
	pub const fn all() -> Self {
		Self {
			kind: WalkFilterKind::All,
			max_file_size: None,
			skip_node_modules_unless_seen: false,
			mentions_node_modules: false,
			glob: None,
			exclude: None,
		}
	}

	/// Return a filter that emits only regular files.
	pub const fn files_only() -> Self {
		Self {
			kind: WalkFilterKind::Files,
			max_file_size: None,
			skip_node_modules_unless_seen: false,
			mentions_node_modules: false,
			glob: None,
			exclude: None,
		}
	}

	/// Return a filter that emits only directories.
	pub const fn dirs_only() -> Self {
		Self {
			kind: WalkFilterKind::Dirs,
			max_file_size: None,
			skip_node_modules_unless_seen: false,
			mentions_node_modules: false,
			glob: None,
			exclude: None,
		}
	}

	/// Limit emitted regular files to `max_file_size` bytes.
	pub const fn max_file_size(mut self, max_file_size: u64) -> Self {
		self.max_file_size = Some(max_file_size);
		self
	}

	/// Skip `node_modules` entries unless the caller's query mentioned them.
	pub const fn node_modules_unless_mentioned(mut self, mentions_node_modules: bool) -> Self {
		self.skip_node_modules_unless_seen = true;
		self.mentions_node_modules = mentions_node_modules;
		self
	}

	/// Accept only entries whose normalized relative path matches `glob`.
	pub fn glob(mut self, glob: CompiledWalkGlob) -> Self {
		self.glob = Some(glob);
		self
	}

	fn accepts_path(&self, relative_path: &str) -> bool {
		self
			.glob
			.as_ref()
			.is_none_or(|glob| glob.is_match(relative_path))
	}

	fn accepts_collected(&self, entry: &CollectedEntry) -> bool {
		if self.skip_node_modules_unless_seen
			&& !self.mentions_node_modules
			&& entry
				.path
				.split('/')
				.any(|component| component == "node_modules")
		{
			return false;
		}
		if self.max_file_size.is_some_and(|max| {
			entry.file_type == FileType::File && entry.size.is_some_and(|size| size > max as f64)
		}) {
			return false;
		}
		let accepts_kind = match self.kind {
			WalkFilterKind::All => true,
			WalkFilterKind::Files => entry.file_type == FileType::File,
			WalkFilterKind::Dirs => entry.file_type == FileType::Dir,
		};
		accepts_kind && self.accepts_path(&entry.path)
	}

	fn stream_decision(&self, meta: &EntryMeta<'_>) -> WalkDecision {
		if self.skip_node_modules_unless_seen
			&& !self.mentions_node_modules
			&& meta
				.relative_path
				.split('/')
				.any(|component| component == "node_modules")
		{
			return if meta.file_type == FileType::Dir {
				WalkDecision::SkipDescend
			} else {
				WalkDecision::Skip
			};
		}
		if self.max_file_size.is_some_and(|max| {
			meta.file_type == FileType::File && meta.size.is_some_and(|size| size > max as f64)
		}) {
			return WalkDecision::Skip;
		}
		let accepts_kind = match self.kind {
			WalkFilterKind::All => true,
			WalkFilterKind::Files => meta.file_type == FileType::File,
			WalkFilterKind::Dirs => meta.file_type == FileType::Dir,
		};
		if !accepts_kind {
			return WalkDecision::Skip;
		}
		if self.accepts_path(meta.relative_path) {
			WalkDecision::Include
		} else {
			WalkDecision::Skip
		}
	}
}

// refused_by: modify_delete_guard · collision: none (no common ancestor text)
#[cfg(test)]
mod tests {
	use std::{
		fs,
		path::PathBuf,
		time::{Duration, SystemTime, UNIX_EPOCH},
	};

	use super::*;

	struct TempTree {
		root: PathBuf,
	}

	impl TempTree {
		fn path(&self) -> &Path {
			&self.root
		}
	}

	impl Drop for TempTree {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.root);
		}
	}

	fn temp_tree(name: &str) -> TempTree {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time should be after UNIX_EPOCH")
			.as_nanos();
		let root = std::env::temp_dir().join(format!("tau-walker-{name}-{unique}"));
		fs::create_dir_all(&root).expect("temp root should be created");
		TempTree { root }
	}

	struct CachePathGuard {
		root: PathBuf,
	}

	impl CachePathGuard {
		fn new(root: &Path) -> Self {
			invalidate_path(root);
			Self { root: root.to_path_buf() }
		}
	}

	impl Drop for CachePathGuard {
		fn drop(&mut self) {
			invalidate_path(&self.root);
		}
	}

	fn wait_for_nonzero_cache_age() {
		let started = std::time::Instant::now();
		while started.elapsed() < Duration::from_millis(1) {
			std::thread::yield_now();
		}
	}

	fn test_options() -> WalkOptions {
		WalkOptions {
			include_hidden:    true,
			use_gitignore:     false,
			skip_git:          true,
			skip_node_modules: true,
			follow_links:      FollowLinks::Never,
			detail:            WalkDetail::Minimal,
			order:             WalkOrder::Path,
			emit_root:         false,
			min_depth:         1,
			max_depth:         usize::MAX,
			contents_first:    false,
			directory_errors:  DirectoryErrorMode::SkipSkippable,
			same_file_system:  false,
			cache:             false,
		}
	}

	fn collect_file_paths(root: &Path, use_gitignore: bool) -> Vec<String> {
		WalkRequest::from_options(root, WalkOptions { use_gitignore, ..test_options() })
			.filter(WalkFilter::files_only())
			.collect()
			.expect("walk should collect successfully")
			.entries
			.into_iter()
			.map(|entry| entry.path)
			.collect()
	}

	#[test]
	fn parent_ignore_outside_repo_does_not_filter_explicit_root() {
		let tree = temp_tree("parent-ignore-outside-repo");
		fs::write(tree.path().join(".gitignore"), "*.nix\n")
			.expect("parent gitignore should be written");
		let project = tree.path().join("projects").join("home-manager");
		fs::create_dir_all(project.join("modules").join("common"))
			.expect("project modules should be created");
		fs::write(project.join("flake.nix"), "flake").expect("flake should be written");
		fs::write(project.join("modules").join("common").join("zsh.nix"), "zsh")
			.expect("module should be written");

		let paths = collect_file_paths(&project, true);

		assert_eq!(
			paths,
			vec!["flake.nix", "modules/common/zsh.nix"],
			"an explicit non-repo search root must not inherit ignore files from unrelated parents"
		);
	}

	#[test]
	fn repo_parent_ignore_still_filters_subdirectory_root() {
		let tree = temp_tree("repo-parent-ignore");
		fs::create_dir_all(tree.path().join(".git")).expect("repo marker should be created");
		fs::write(tree.path().join(".gitignore"), "*.nix\n")
			.expect("repo gitignore should be written");
		let project = tree.path().join("projects").join("home-manager");
		fs::create_dir_all(project.join("modules").join("common"))
			.expect("project modules should be created");
		fs::write(project.join("flake.nix"), "flake").expect("flake should be written");
		fs::write(project.join("modules").join("common").join("zsh.nix"), "zsh")
			.expect("module should be written");

		let paths = collect_file_paths(&project, true);

		assert!(
			paths.is_empty(),
			"repo-root .gitignore should still apply when walking a subdirectory root, got {paths:?}"
		);
	}

	#[test]
	fn explicit_ignored_root_keeps_unrelated_parent_and_nested_ignore_rules() {
		let tree = temp_tree("explicit-ignored-root");
		fs::create_dir_all(tree.path().join(".git")).expect("repo marker should be created");
		fs::write(tree.path().join(".gitignore"), "*.log\nignored/**\n")
			.expect("repo gitignore should be written");
		let project = tree.path().join("ignored").join("package");
		let nested = project.join("nested");
		fs::create_dir_all(&nested).expect("ignored project tree should be created");
		fs::write(project.join("keep.ts"), "keep").expect("kept file should be written");
		fs::write(project.join("trace.log"), "trace").expect("parent-ignored file should be written");
		fs::write(nested.join(".gitignore"), "generated.ts\n")
			.expect("nested gitignore should be written");
		fs::write(nested.join("generated.ts"), "generated")
			.expect("nested ignored file should be written");
		fs::write(nested.join("keep.ts"), "nested keep").expect("nested kept file should be written");

		let paths = collect_file_paths(&project, true);

		assert_eq!(paths, vec!["keep.ts", "nested/.gitignore", "nested/keep.ts"]);
	}

	#[test]
	fn ranked_collection_matches_full_sort_after_filtering_at_every_limit() {
		let tree = temp_tree("ranked-limits");
		fs::create_dir(tree.path().join("nested")).expect("create nested directory");
		for index in 0..24 {
			let relative = format!("nested/{index:02}.txt");
			let file = fs::File::create(tree.path().join(relative)).expect("create ranked file");
			file.set_len(index).expect("set size");
			file
				.set_modified(UNIX_EPOCH + Duration::from_secs(100 + index / 3))
				.expect("set modification time");
		}
		let request = WalkRequest::from_options(tree.path(), WalkOptions {
			detail: WalkDetail::Full,
			..test_options()
		})
		.filter(WalkFilter::files_only().max_file_size(20))
		.limit(1);
		for rank in [WalkRank::PathAsc, WalkRank::MtimeDescPathAsc] {
			for limit in [0, 1, 4, 21, 100, usize::MAX] {
				let reference = request
					.clone()
					.cache(true)
					.collect_ranked(rank, limit)
					.expect("full-sort cached collector");
				let actual = request
					.collect_ranked(rank, limit)
					.expect("streaming ranked collector");
				assert_eq!(actual.entries, reference.entries);
				assert_eq!(actual.stats.scanned_entries, 25);
				assert_eq!(actual.stats.filtered_entries, 4);
				assert_eq!(actual.stats.limited_entries, 21usize.saturating_sub(limit));
				assert_eq!(actual.backend, WalkBackend::Fresh);
			}
		}
	}

	#[test]
	fn ranked_collection_keeps_heartbeat_cancellation_after_limit_is_filled() {
		let tree = temp_tree("ranked-cancel");
		for index in 0..300 {
			fs::write(tree.path().join(format!("{index}.txt")), "x").expect("create file");
		}
		for limit in [0, 1] {
			let beats = std::sync::atomic::AtomicUsize::new(0);
			let result = WalkRequest::from_options(tree.path(), test_options())
				.collect_ranked_with_heartbeat(WalkRank::PathAsc, limit, || {
					if beats.fetch_add(1, AtomicOrdering::Relaxed) == 0 {
						Ok(())
					} else {
						Err("cancelled")
					}
				});
			assert!(matches!(result, Err(WalkError::Interrupted(message)) if message == "cancelled"));
		}
	}

	#[test]
	fn ranked_heap_preserves_total_float_order_and_path_ties() {
		let filter = WalkFilter::default();
		let inputs = [
			("missing", None),
			("negative-nan", Some(-f64::NAN)),
			("negative-zero", Some(-0.0)),
			("tie-z", Some(2.0)),
			("positive-zero", Some(0.0)),
			("positive-nan", Some(f64::NAN)),
			("infinity", Some(f64::INFINITY)),
			("tie-a", Some(2.0)),
		];
		let expected = [
			"positive-nan",
			"infinity",
			"tie-a",
			"tie-z",
			"positive-zero",
			"negative-zero",
			"negative-nan",
			"missing",
		];
		for limit in [0, 1, 4, 8, 100] {
			let mut collector = RankedCollectVisitor::new(&filter, WalkRank::MtimeDescPathAsc, limit);
			for (relative, mtime) in inputs {
				collector
					.visit(Entry {
						path: Path::new(relative),
						relative,
						name: OsStr::new(relative),
						file_type: FileType::File,
						mtime,
						size: None,
						depth: 1,
					})
					.expect("collect synthetic metadata");
				assert!(collector.entries.len() <= limit);
			}
			let outcome = collector.into_outcome();
			assert_eq!(
				outcome
					.entries
					.iter()
					.map(|entry| entry.path.as_str())
					.collect::<Vec<_>>(),
				expected[..limit.min(expected.len())]
			);
			assert_eq!(outcome.stats.scanned_entries, inputs.len());
			assert_eq!(outcome.stats.limited_entries, inputs.len().saturating_sub(limit));
		}
	}

	#[test]
	fn walk_request_files_only_returns_relative_files_and_excludes_directories() {
		let tree = temp_tree("request-files-only");
		fs::write(tree.path().join("alpha.txt"), "alpha").expect("top-level file should be written");
		fs::create_dir_all(tree.path().join("nested")).expect("nested dir should be created");
		fs::write(tree.path().join("nested").join("beta.txt"), "beta")
			.expect("nested file should be written");

		let outcome = WalkRequest::from_options(tree.path(), test_options())
			.filter(WalkFilter::files_only())
			.collect()
			.expect("files-only request should collect successfully");
		let paths = outcome
			.entries
			.iter()
			.map(|entry| entry.path.as_str())
			.collect::<Vec<_>>();

		assert_eq!(
			paths,
			vec!["alpha.txt", "nested/beta.txt"],
			"files-only requests should preserve relative file paths and exclude directory entries"
		);
		assert!(
			outcome.entries.iter().all(CollectedEntry::is_file),
			"files-only requests should not return directories or other entry kinds: {:?}",
			outcome.entries
		);
	}

	#[test]
	fn compare_depth_first_paths_orders_children_before_parent() {
		let mut paths = vec!["dir", "alpha", "dir/child", "dir/child/grandchild"];

		paths.sort_unstable_by(|left, right| compare_depth_first_paths(left, right));

		assert_eq!(
			paths,
			vec!["alpha", "dir/child/grandchild", "dir/child", "dir"],
			"depth-first ordering should keep lexical siblings stable while placing descendants \
			 before ancestors"
		);
	}

	#[test]
	fn walk_request_collect_contents_first_uses_collected_fallback() {
		let tree = temp_tree("request-contents-first");
		fs::create_dir_all(tree.path().join("nested")).expect("nested dir should be created");
		fs::write(tree.path().join("nested").join("leaf.txt"), "leaf")
			.expect("nested file should be written");

		let outcome = WalkRequest::from_options(tree.path(), test_options())
			.visit_order(VisitOrder::ContentsFirst)
			.collect()
			.expect("contents-first request should collect through high-level fallback");
		let paths = outcome
			.entries
			.iter()
			.map(|entry| entry.path.as_str())
			.collect::<Vec<_>>();

		assert_eq!(
			paths,
			vec!["nested/leaf.txt", "nested"],
			"contents-first collection should replay children before their directory"
		);
	}

	#[test]
	fn walk_request_stream_fallback_preserves_predicate_skip_descend() {
		struct RecordingVisitor {
			paths: Vec<String>,
		}

		impl EntryVisitor for RecordingVisitor {
			type Error = Infallible;

			fn visit(&mut self, entry: Entry<'_>) -> std::result::Result<WalkControl, Self::Error> {
				self.paths.push(entry.relative.to_string());
				Ok(WalkControl::Continue)
			}
		}

		let tree = temp_tree("request-stream-skip-descend");
		fs::create_dir_all(tree.path().join("keep")).expect("keep dir should be created");
		fs::write(tree.path().join("keep").join("leaf.txt"), "leaf")
			.expect("kept leaf should be written");
		fs::create_dir_all(tree.path().join("skip")).expect("skip dir should be created");
		fs::write(tree.path().join("skip").join("hidden.txt"), "hidden")
			.expect("skipped leaf should be written");

		let mut visitor = RecordingVisitor { paths: Vec::new() };
		let status = WalkRequest::from_options(tree.path(), test_options())
			.visit_order(VisitOrder::ContentsFirst)
			.stream_with_predicate(&mut visitor, |meta: &EntryMeta<'_>| {
				if meta.relative_path == "skip" {
					WalkDecision::SkipDescend
				} else {
					WalkDecision::Include
				}
			})
			.expect("contents-first stream fallback should complete");

		assert_eq!(status, WalkStatus::Complete);
		assert_eq!(
			visitor.paths,
			vec!["keep/leaf.txt", "keep"],
			"predicate SkipDescend should prune the skipped directory and its descendants before \
			 contents-first replay"
		);
	}

	#[test]
	fn walk_request_collect_with_heartbeat_propagates_interruptions() {
		let tree = temp_tree("request-heartbeat");
		fs::write(tree.path().join("alpha.txt"), "alpha").expect("file should be written");

		let result = WalkRequest::from_options(tree.path(), test_options())
			.collect_with_heartbeat(|| Err("stop requested"));

		let Err(WalkError::Interrupted(message)) = result else {
			panic!("heartbeat interruption should be surfaced as WalkError::Interrupted");
		};
		assert_eq!(message, "stop requested");
	}

	#[test]
	fn walk_request_rechecks_stale_empty_cached_files_only_result() {
		let _cache_test_guard = cache::cache_test_guard();
		let tree = temp_tree("request-empty-recheck");
		let _cache_guard = CachePathGuard::new(tree.path());
		let request = WalkRequest::from_options(tree.path(), test_options())
			.cache(true)
			.filter(WalkFilter::files_only())
			.empty_recheck(EmptyRecheck::Never);

		let primed = request
			.collect()
			.expect("empty request should collect successfully");
		assert_eq!(primed.backend, WalkBackend::Fresh);
		assert!(
			primed.entries.is_empty(),
			"empty root should prime an empty files-only cache entry, got {:?}",
			primed.entries
		);

		fs::write(tree.path().join("created.txt"), "created")
			.expect("file created after cache prime should be written");
		wait_for_nonzero_cache_age();

		let stale = request
			.collect()
			.expect("empty recheck disabled request should read the cached empty result");
		assert_eq!(stale.backend, WalkBackend::Cached);
		assert!(
			stale.stats.cache_age_ms > 0,
			"cached empty result should be old enough to exercise empty recheck"
		);
		assert!(
			stale.entries.is_empty(),
			"disabled empty recheck should leave the cached empty files-only result untouched"
		);

		let refreshed = request
			.empty_recheck(EmptyRecheck::AfterMillis(0))
			.collect()
			.expect("stale empty cache should be rechecked without manual invalidation");
		let paths = refreshed
			.entries
			.iter()
			.map(|entry| entry.path.as_str())
			.collect::<Vec<_>>();

		assert_eq!(
			refreshed.backend,
			WalkBackend::Fresh,
			"stale empty cache recheck should force a fresh scan"
		);
		assert_eq!(
			paths,
			vec!["created.txt"],
			"empty cached files-only requests should observe files created after the cache was primed"
		);
		assert!(
			refreshed.entries.iter().all(CollectedEntry::is_file),
			"files-only empty recheck should still return only files: {:?}",
			refreshed.entries
		);
	}

	#[test]
	fn walk_request_rechecks_stale_cache_empty_after_glob_filter() {
		let _cache_test_guard = cache::cache_test_guard();
		let tree = temp_tree("request-filtered-empty-recheck");
		let _cache_guard = CachePathGuard::new(tree.path());
		fs::write(tree.path().join("old.txt"), "old")
			.expect("nonmatching file should be written before cache prime");
		let request = WalkRequest::from_options(tree.path(), test_options())
			.cache(true)
			.filter(
				WalkFilter::files_only()
					.glob(CompiledWalkGlob::new(["*.rs"]).expect("test glob should compile")),
			)
			.empty_recheck(EmptyRecheck::Never);

		let primed = request
			.collect()
			.expect("filtered request should prime the raw nonempty cache successfully");
		assert_eq!(primed.backend, WalkBackend::Fresh);
		assert_eq!(
			primed.stats.scanned_entries, 1,
			"cache prime should scan the nonmatching file before filtering"
		);
		assert_eq!(
			primed.stats.filtered_entries, 1,
			"glob filter should remove the nonmatching cached file"
		);
		assert!(
			primed.entries.is_empty(),
			"nonmatching file should leave the filtered prime result empty: {:?}",
			primed.entries
		);

		fs::write(tree.path().join("new.rs"), "new")
			.expect("matching file should be written after cache prime");
		wait_for_nonzero_cache_age();

		let refreshed = request
			.empty_recheck(EmptyRecheck::AfterMillis(0))
			.collect()
			.expect("filtered empty cached result should be rechecked without manual invalidation");
		let paths = refreshed
			.entries
			.iter()
			.map(|entry| entry.path.as_str())
			.collect::<Vec<_>>();

		assert_eq!(
			refreshed.backend,
			WalkBackend::Fresh,
			"stale cache that is empty only after filtering should force a fresh scan"
		);
		assert_eq!(
			paths,
			vec!["new.rs"],
			"filtered empty-cache recheck should return the file that matches the glob"
		);
		assert!(
			refreshed.entries.iter().all(CollectedEntry::is_file),
			"glob-filtered files-only recheck should still return only files: {:?}",
			refreshed.entries
		);
	}

	#[test]
	fn collect_entries_honors_gitignore_without_repo_marker() {
		let tree = temp_tree("plain-gitignore");
		fs::write(tree.path().join(".gitignore"), "ignored.txt\n")
			.expect(".gitignore should be written");
		fs::write(tree.path().join("ignored.txt"), "ignored")
			.expect("ignored file should be written");
		fs::write(tree.path().join("kept.txt"), "keep").expect("kept file should be written");

		let scan = collect_entries(
			tree.path(),
			WalkOptions { use_gitignore: true, cache: false, ..test_options() },
			|| Ok::<(), Infallible>(()),
		)
		.expect("collection should not fail");
		let paths = scan
			.entries
			.into_iter()
			.map(|entry| entry.path)
			.collect::<Vec<_>>();

		assert!(
			paths.iter().any(|path| path == "kept.txt"),
			"collect_entries should include kept.txt from a plain directory, got: {paths:?}"
		);
		assert!(
			!paths.iter().any(|path| path == "ignored.txt"),
			"collect_entries should exclude .gitignore matches without a .git marker, got: {paths:?}"
		);
	}

	#[test]
	fn collect_entries_ignores_parent_gitignore_above_non_repo_root() {
		let tree = temp_tree("ancestor-gitignore-non-repo-root");
		let search_root = tree.path().join("project");
		fs::create_dir_all(&search_root).expect("explicit search root should be created");
		fs::write(tree.path().join(".gitignore"), "*.nix\n")
			.expect("ancestor .gitignore should be written");
		fs::write(search_root.join("module.nix"), "nix").expect("nix file should be written");
		fs::write(search_root.join("kept.txt"), "keep").expect("kept file should be written");

		let scan = collect_entries(
			&search_root,
			WalkOptions { use_gitignore: true, cache: false, ..test_options() },
			|| Ok::<(), Infallible>(()),
		)
		.expect("collection should not fail");
		let paths = scan
			.entries
			.into_iter()
			.map(|entry| entry.path)
			.collect::<Vec<_>>();

		assert!(
			paths.iter().any(|path| path == "module.nix"),
			"ancestor .gitignore outside a non-repo explicit root should not hide module.nix, got: \
			 {paths:?}"
		);
		assert!(
			paths.iter().any(|path| path == "kept.txt"),
			"sanity check should include kept.txt from the explicit root, got: {paths:?}"
		);
	}

	#[test]
	fn collect_entries_applies_repo_root_gitignore_to_subdirectory_search_root() {
		let tree = temp_tree("repo-root-gitignore-subdir-root");
		let search_root = tree.path().join("src");
		fs::create_dir_all(tree.path().join(".git")).expect("repo marker should be created");
		fs::create_dir_all(&search_root).expect("explicit search root should be created");
		fs::write(tree.path().join(".gitignore"), "*.nix\n")
			.expect("repo-root .gitignore should be written");
		fs::write(search_root.join("module.nix"), "nix").expect("ignored nix file should be written");
		fs::write(search_root.join("kept.txt"), "keep").expect("kept file should be written");

		let scan = collect_entries(
			&search_root,
			WalkOptions { use_gitignore: true, cache: false, ..test_options() },
			|| Ok::<(), Infallible>(()),
		)
		.expect("collection should not fail");
		let paths = scan
			.entries
			.into_iter()
			.map(|entry| entry.path)
			.collect::<Vec<_>>();

		assert!(
			!paths.iter().any(|path| path == "module.nix"),
			"repo-root .gitignore should hide module.nix when searching inside that repo, got: \
			 {paths:?}"
		);
		assert!(
			paths.iter().any(|path| path == "kept.txt"),
			"repo subdirectory search should still include nonignored files, got: {paths:?}"
		);
	}

	#[test]
	fn collect_entries_with_exact_workspace_options() {
		let tree = temp_tree("exact-options");
		fs::write(tree.path().join(".gitignore"), "ignored.txt\n")
			.expect(".gitignore should be written");
		fs::write(tree.path().join("ignored.txt"), "ignored")
			.expect("ignored file should be written");
		fs::write(tree.path().join("kept.txt"), "keep").expect("kept file should be written");

		let scan = collect_entries(
			tree.path(),
			WalkOptions {
				include_hidden: false,
				use_gitignore: true,
				detail: WalkDetail::Full,
				max_depth: 4,
				..test_options()
			},
			|| Ok::<(), Infallible>(()),
		)
		.expect("collection should not fail");
		let paths = scan
			.entries
			.into_iter()
			.map(|entry| entry.path)
			.collect::<Vec<_>>();

		assert!(
			!paths.iter().any(|path| path == "ignored.txt"),
			"should exclude ignored.txt, got: {paths:?}"
		);
	}

	#[test]
	fn collect_entries_prunes_hidden_git_and_node_modules() {
		let tree = temp_tree("filters");
		fs::write(tree.path().join("visible.txt"), "ok").expect("visible file should be written");
		fs::write(tree.path().join(".hidden"), "hidden").expect("hidden file should be written");
		fs::create_dir_all(tree.path().join(".git")).expect(".git should be created");
		fs::write(tree.path().join(".git").join("config"), "git")
			.expect("git file should be written");
		fs::create_dir_all(tree.path().join("node_modules")).expect("node_modules should be created");
		fs::write(tree.path().join("node_modules").join("pkg.js"), "pkg")
			.expect("node module file should be written");

		let scan = collect_entries(
			tree.path(),
			WalkOptions { include_hidden: false, ..test_options() },
			|| Ok::<(), Infallible>(()),
		)
		.expect("collection should not fail");
		let paths = scan
			.entries
			.into_iter()
			.map(|entry| entry.path)
			.collect::<Vec<_>>();
		assert_eq!(paths, vec!["visible.txt"]);
	}

	struct PruneVisitor {
		seen: Vec<String>,
	}

	impl EntryVisitor for PruneVisitor {
		type Error = Infallible;

		fn visit(&mut self, entry: Entry<'_>) -> std::result::Result<WalkControl, Self::Error> {
			self.seen.push(entry.relative.to_string());
			if entry.relative == "skip" {
				Ok(WalkControl::SkipDescend)
			} else {
				Ok(WalkControl::Continue)
			}
		}
	}

	#[cfg(unix)]
	struct PathsVisitor {
		seen: Vec<String>,
	}

	#[cfg(unix)]
	impl EntryVisitor for PathsVisitor {
		type Error = Infallible;

		fn visit(&mut self, entry: Entry<'_>) -> std::result::Result<WalkControl, Self::Error> {
			self.seen.push(entry.relative.to_string());
			Ok(WalkControl::Continue)
		}
	}

	#[cfg(unix)]
	fn walk_paths(root: &Path, follow_links: FollowLinks) -> Vec<String> {
		let mut visitor = PathsVisitor { seen: Vec::new() };
		let status =
			walk_entries(root, WalkOptions { follow_links, ..test_options() }, &mut visitor, || {
				Ok::<(), Infallible>(())
			})
			.expect("walk should not fail");
		assert_eq!(status, WalkStatus::Complete);
		visitor.seen
	}

	#[test]
	fn skip_descend_prunes_directory_children() {
		let tree = temp_tree("skip-descend");
		fs::create_dir_all(tree.path().join("keep")).expect("keep dir should be created");
		fs::write(tree.path().join("keep").join("file.txt"), "ok")
			.expect("keep file should be written");
		fs::create_dir_all(tree.path().join("skip")).expect("skip dir should be created");
		fs::write(tree.path().join("skip").join("file.txt"), "no")
			.expect("skip file should be written");

		let mut visitor = PruneVisitor { seen: Vec::new() };
		let _status =
			walk_entries(tree.path(), test_options(), &mut visitor, || Ok::<(), Infallible>(()))
				.expect("walk should not fail");
		assert!(visitor.seen.iter().any(|path| path == "skip"));
		assert!(visitor.seen.iter().any(|path| path == "keep/file.txt"));
		assert!(!visitor.seen.iter().any(|path| path == "skip/file.txt"));
	}

	#[cfg(unix)]
	#[test]
	fn walk_entries_always_follows_descendant_symlink_directories() {
		let tree = temp_tree("follow-always");
		fs::create_dir_all(tree.path().join("target")).expect("target dir should be created");
		fs::write(tree.path().join("target").join("child.txt"), "ok")
			.expect("target child should be written");
		std::os::unix::fs::symlink(tree.path().join("target"), tree.path().join("link"))
			.expect("directory symlink should be created");

		let paths = walk_paths(tree.path(), FollowLinks::Always);

		assert!(
			paths.iter().any(|path| path == "link/child.txt"),
			"FollowLinks::Always should yield descendants through symlink paths, got: {paths:?}"
		);
	}

	#[cfg(unix)]
	#[test]
	fn walk_entries_roots_follows_root_symlink_but_not_descendant_symlinks() {
		let target = temp_tree("follow-roots-target");
		fs::write(target.path().join("child.txt"), "ok").expect("root child should be written");

		let linked_target = temp_tree("follow-roots-linked-target");
		fs::write(linked_target.path().join("linked-child.txt"), "linked")
			.expect("linked child should be written");
		std::os::unix::fs::symlink(linked_target.path(), target.path().join("descendant-link"))
			.expect("descendant directory symlink should be created");

		let link_parent = temp_tree("follow-roots-link-parent");
		let root_link = link_parent.path().join("root-link");
		std::os::unix::fs::symlink(target.path(), &root_link)
			.expect("root directory symlink should be created");

		let paths = walk_paths(&root_link, FollowLinks::Roots);

		assert!(
			paths.iter().any(|path| path == "child.txt"),
			"FollowLinks::Roots should traverse children of a symlink root, got: {paths:?}"
		);
		assert!(
			!paths
				.iter()
				.any(|path| path == "descendant-link/linked-child.txt"),
			"FollowLinks::Roots should not traverse descendant symlink directories, got: {paths:?}"
		);
	}

	#[cfg(unix)]
	#[test]
	fn walk_entries_never_does_not_follow_root_symlink_directory() {
		let target = temp_tree("follow-never-target");
		fs::write(target.path().join("child.txt"), "ok").expect("root child should be written");

		let link_parent = temp_tree("follow-never-link-parent");
		let root_link = link_parent.path().join("root-link");
		std::os::unix::fs::symlink(target.path(), &root_link)
			.expect("root directory symlink should be created");

		let paths = walk_paths(&root_link, FollowLinks::Never);

		assert!(
			!paths.iter().any(|path| path == "child.txt"),
			"FollowLinks::Never should not traverse a symlink root, got: {paths:?}"
		);
	}
}

pub use fs::{Detail, FileType, Fs};
