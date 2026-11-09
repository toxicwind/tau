//! Linux FICLONE-based copy-on-write tree materialisation.
//!
//! This backend recursively builds a writable directory tree at `merged` from
//! `lower`. Directories and symlinks are recreated, while regular files are
//! cloned with [`cow`](crate::cow) (the Linux
//! `FICLONE` ioctl) so filesystems such as btrfs, XFS,
//! OCFS2, and bcachefs can share extents until either side is modified. There
//! is no mount or kernel state to undo, so [`stop`](IsolationBackend::stop) is
//! a recursive remove.

use std::path::Path;

use async_trait::async_trait;

#[cfg(not(target_os = "linux"))]
use crate::IsoError;
use crate::{BackendKind, IsoResult, IsolationBackend, ProbeResult};

pub struct LinuxReflinkBackend;

pub fn backend() -> &'static dyn IsolationBackend {
	&LinuxReflinkBackend
}

#[async_trait]
impl IsolationBackend for LinuxReflinkBackend {
	fn kind(&self) -> BackendKind {
		BackendKind::LinuxReflink
	}

	fn probe(&self) -> ProbeResult {
		#[cfg(target_os = "linux")]
		{
			ProbeResult::available()
		}
		#[cfg(not(target_os = "linux"))]
		{
			ProbeResult::unavailable("Linux FICLONE reflink isolation is only available on Linux")
		}
	}

	fn start(&self, lower: &Path, merged: &Path) -> IsoResult<()> {
		#[cfg(target_os = "linux")]
		{
			imp::start(lower, merged)
		}
		#[cfg(not(target_os = "linux"))]
		{
			let _ = (lower, merged);
			Err(IsoError::unavailable("Linux FICLONE reflink isolation is only available on Linux"))
		}
	}

	fn clone_tree(&self, lower: &Path, merged: &Path, skip: &[&std::ffi::OsStr]) -> IsoResult<()> {
		#[cfg(target_os = "linux")]
		{
			imp::clone_tree(lower, merged, skip)
		}
		#[cfg(not(target_os = "linux"))]
		{
			let _ = (lower, merged, skip);
			Err(IsoError::unavailable("Linux FICLONE reflink isolation is only available on Linux"))
		}
	}

	fn stop(&self, merged: &Path) -> IsoResult<()> {
		#[cfg(target_os = "linux")]
		{
			imp::stop(merged)
		}
		#[cfg(not(target_os = "linux"))]
		{
			let _ = merged;
			Ok(())
		}
	}
}

#[cfg(target_os = "linux")]
mod imp {
	use std::{
		fs::{self, FileTimes, FileType},
		os::unix::fs::PermissionsExt,
		path::Path,
	};

	use crate::{
		IsoError, IsoResult, cow,
		tree::{self, TreeCopy},
	};

	pub fn start(lower: &Path, merged: &Path) -> IsoResult<()> {
		clone_tree(lower, merged, &[])
	}

	pub fn clone_tree(lower: &Path, merged: &Path, skip: &[&std::ffi::OsStr]) -> IsoResult<()> {
		let lower = tree::canonical_existing_dir(lower, "reflink source", IsoError::other)?;
		tree::prepare_destination(merged, "reflink clone", tree::remove_existing)?;
		let result = (|| {
			fs::create_dir(merged)
				.map_err(|err| IsoError::other(format!("create {}: {err}", merged.display())))?;
			tree::copy_dir_contents(&lower, merged, skip, &Reflink)?;
			Reflink.finish_dir(&lower, merged)
		})();
		if result.is_err() {
			let _ = fs::remove_dir_all(merged);
		}
		result
	}

	pub fn stop(merged: &Path) -> IsoResult<()> {
		match fs::remove_dir_all(merged) {
			Ok(()) => Ok(()),
			Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
			Err(err) => Err(IsoError::other(format!(
				"unable to remove reflink tree {}: {err}",
				merged.display()
			))),
		}
	}

	struct Reflink;

	impl TreeCopy for Reflink {
		fn symlink(&self, src: &Path, dst: &Path, file_type: FileType) -> IsoResult<()> {
			tree::copy_symlink(src, dst, file_type)?;
			if let Ok(meta) = fs::symlink_metadata(src) {
				let _ = set_times_nofollow(dst, &meta);
			}
			Ok(())
		}

		fn file(&self, src: &Path, dst: &Path, file_type: FileType) -> IsoResult<()> {
			if !file_type.is_file() {
				return Err(IsoError::other(format!(
					"unsupported file type in reflink source: {}",
					src.display()
				)));
			}
			clone_file(src, dst)
		}

		fn finish_dir(&self, src: &Path, dst: &Path) -> IsoResult<()> {
			let meta = fs::symlink_metadata(src)
				.map_err(|err| IsoError::other(format!("symlink_metadata {}: {err}", src.display())))?;
			preserve_permissions(dst, &meta)?;
			let _ = set_times_nofollow(dst, &meta);
			Ok(())
		}
	}

// refused_by: container_member · collision: none (no common ancestor text)
	fn recursive_reflink(
		src: &Path,
		dst: &Path,
		skip: Option<&[&std::ffi::OsStr]>,
	) -> IsoResult<()> {
		let meta = fs::symlink_metadata(src)
			.map_err(|err| IsoError::other(format!("symlink_metadata {}: {err}", src.display())))?;
		fs::create_dir(dst)
			.map_err(|err| IsoError::other(format!("create {}: {err}", dst.display())))?;

		let entries = fs::read_dir(src)
			.map_err(|err| IsoError::other(format!("read_dir {}: {err}", src.display())))?;
		for entry in entries {
			let entry = entry
				.map_err(|err| IsoError::other(format!("dir entry in {}: {err}", src.display())))?;
			if skip.is_some_and(|names| names.contains(&entry.file_name().as_os_str()))
				|| crate::is_secret_filename(&entry.file_name())
			{
				continue;
			}
			let file_type = entry.file_type().map_err(|err| {
				IsoError::other(format!("file_type {}: {err}", entry.path().display()))
			})?;
			let src_path = entry.path();
			let dst_path = dst.join(entry.file_name());
			if file_type.is_symlink() {
				clone_symlink(&src_path, &dst_path)?;
			} else if file_type.is_dir() {
				recursive_reflink(&src_path, &dst_path, None)?;
			} else if file_type.is_file() {
				clone_file(&src_path, &dst_path)?;
			} else {
				return Err(IsoError::other(format!(
					"unsupported file type in reflink source: {}",
					src_path.display()
				)));
			}
		}

		preserve_permissions(dst, &meta)?;
		let _ = set_times_nofollow(dst, &meta);
		Ok(())
	}

	/// Clones the regular file `src` into the fresh tree, then gives the clone
	/// `src`'s mode and timestamps through the descriptors the clone used.
	fn clone_file(src: &Path, dst: &Path) -> IsoResult<()> {
		let (src_file, dst_file) =
			cow::clone_new(src, dst).map_err(|err| map_clone_error(src, dst, &err))?;
		let meta = src_file
			.metadata()
			.map_err(|err| IsoError::other(format!("metadata {}: {err}", src.display())))?;
		dst_file
			.set_permissions(meta.permissions())
			.map_err(|err| IsoError::other(format!("set permissions on {}: {err}", dst.display())))?;
		let mut times = FileTimes::new();
		if let Ok(accessed) = meta.accessed() {
			times = times.set_accessed(accessed);
		}
		if let Ok(modified) = meta.modified() {
			times = times.set_modified(modified);
		}
		let _ = dst_file.set_times(times);
		Ok(())
	}

	fn map_clone_error(src: &Path, dst: &Path, err: &std::io::Error) -> IsoError {
		if cow::is_unsupported(err) {
			return IsoError::unavailable(format!(
				"FICLONE unsupported for {} -> {}: {err}",
				src.display(),
				dst.display()
			));
		}
		IsoError::other(format!("FICLONE {} -> {}: {err}", src.display(), dst.display()))
	}

	fn preserve_permissions(path: &Path, meta: &fs::Metadata) -> IsoResult<()> {
		let mode = meta.permissions().mode();
		fs::set_permissions(path, fs::Permissions::from_mode(mode))
			.map_err(|err| IsoError::other(format!("set permissions on {}: {err}", path.display())))
	}

	/// Not following preserves symlink timestamps instead of mutating the link
	/// target.
	fn set_times_nofollow(path: &Path, meta: &fs::Metadata) -> std::io::Result<()> {
		let times = FileTimes::new()
			.set_accessed(meta.accessed()?)
			.set_modified(meta.modified()?);
		fs::set_times_nofollow(path, times)
	}
}
