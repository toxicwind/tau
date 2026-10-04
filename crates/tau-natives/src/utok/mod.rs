//! Universal offline tokenizer.
//!
//! Exact token counting (and, where meaningful, encoding) for six model
//! families, with all vocabulary data zstd-compressed and embedded in the
//! binary. No network, no files, no external tokenizer runtimes.
//!
//! | [`Encoding`] | family | mechanism |
//! |---|---|---|
//! | `O200kBase` | GPT-4o / o1 / GPT-5+ | byte-level BPE (tiktoken ranks) |
//! | `Cl100kBase` | GPT-3.5 / GPT-4 | byte-level BPE |
//! | `ClaudeV3` / `ClaudeV47` / `ClaudeV5` / `ClaudeV5Sonnet` | Claude generations | ctok count reconstruction (count-only) |
//! | `Qwen3` | Qwen 3.5 / 3.6 / 3.8 (248k vocab) | byte-level BPE + NFC |
//! | `DeepSeekV3` | `DeepSeek` V3 … V4 | byte-level BPE, 3-stage split chain |
//! | `KimiK2` | Kimi K2 … K3 | byte-level BPE (tiktoken ranks) |
//! | `Glm5` | GLM-5.x (exact), GLM-4.x (near-exact) | byte-level BPE, `ignore_merges` |
//! | `Jev` | `TypeSafe` Jev 1.13 | measured whole-word vocab + restricted o200k BPE (count-only) |
//!
//! Semantics are `encode_ordinary`: plain content, no special tokens, no
//! chat-template frame. This matches budget-estimation use where fragments
//! are summed.
//!
//! Input is encoding-generic ([`Utf`]): `&str`/`String` (UTF-8), `&[u16]`
//! (UTF-16, e.g. a JS string over napi) and `&[u32]` (UTF-32) tokenize
//! natively in their own code units — no UTF-8 transcode, no scratch
//! buffer. The pre-tokenizer scans a codepoint [`Cursor`], and rank tables
//! lazily expand per-flavor lookup views (`bpe.rs`). Valid text yields
//! flavor-invariant ids/counts; malformed units decode permissively as
//! U+FFFD (matching a lossy JS crossing).

mod bpe;
mod claude;
mod jev;
mod pretoken;
mod scan;
mod tables;
mod utf;
pub use self::{
	bpe::{BpeLoadError, RankTable},
	utf::{Cursor, Unit, Utf},
};

/// A tokenizer family. Copy-cheap; all state is in lazily-initialized
/// process-wide tables (first use pays one zstd decode of ~0.5–1 MB).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Encoding {
	/// GPT-4o / o1 / GPT-5 (`OpenAI` default).
	O200kBase,
	/// GPT-3.5 / GPT-4 / older `OpenAI`.
	Cl100kBase,
	/// Claude 3 through Opus 4.6 (and every non-opus Claude < 5).
	ClaudeV3,
	/// Claude Opus 4.7–4.9.
	ClaudeV47,
	/// Claude Opus 5+.
	ClaudeV5,
	/// Claude Sonnet/Fable 5+ (non-opus 5-series frame variant).
	ClaudeV5Sonnet,
	/// Qwen 3.5 / 3.6 / 3.8 (248,044-token vocabulary, NFC input).
	Qwen3,
	/// `DeepSeek` V3 / V3.1 / V3.2 / R1 / V4 (identical base BPE).
	DeepSeekV3,
	/// Kimi K2 / K2.5 / K3 (163,584-token base vocabulary).
	KimiK2,
	/// GLM-5 (154,820-token vocabulary; ID-preserving superset of GLM-4.x).
	Glm5,
	/// `TypeSafe` Jev 1.13 `state` input tokens (measured reconstruction).
	Jev,
}

impl Encoding {
	/// Exact content token count of `text` (no specials, no message frame),
	/// in any UTF flavor.
	///
	/// # Panics
	///
	/// If the family's embedded blob is corrupt. Layers 1, 2 and 4 of the
	/// hardening in [`tables`] make that unreachable in a built binary: the
	/// `const _` assertion fails the build and `build.rs` fails the build. Use
	/// [`try_count`](Self::try_count) to handle it as a value instead.
	pub fn count<T: Utf + ?Sized>(self, text: &T) -> u32 {
		self.try_count(text).unwrap_or_else(|e| panic!("{e}"))
	}

	/// Fallible [`count`](Self::count): the same token count, with a missing
	/// or corrupt vocabulary surfaced as a typed error.
	pub fn try_count<T: Utf + ?Sized>(self, text: &T) -> Result<u32, BpeLoadError> {
		match self {
			Self::ClaudeV3 => Ok(claude::content_token_count(text.units(), claude::Family::V3)),
			Self::ClaudeV47 => {
				Ok(claude::content_token_count(text.units(), claude::Family::V47))
			},
			Self::ClaudeV5 => Ok(claude::content_token_count(text.units(), claude::Family::V5)),
			Self::ClaudeV5Sonnet => {
				Ok(claude::content_token_count(text.units(), claude::Family::V5Sonnet))
			},
			Self::Jev => jev::content_token_count(text.units()),
			_ => Ok(tables::bpe_for(self)?.count(text.units())),
		}
	}

	/// Token ids for `text`, in any UTF flavor.
	///
	/// `None` for the Claude families and Jev: both are reconstructed from
	/// counts, not boundaries, so no id sequence exists.
	///
	/// # Panics
	///
	/// If the family's embedded blob is corrupt. Use
	/// [`try_encode`](Self::try_encode) to handle that as a value.
	pub fn encode<T: Utf + ?Sized>(self, text: &T) -> Option<Vec<u32>> {
		self.try_encode(text).unwrap_or_else(|e| panic!("{e}"))
	}

	/// Fallible [`encode`](Self::encode).
	pub fn try_encode<T: Utf + ?Sized>(self, text: &T) -> Result<Option<Vec<u32>>, BpeLoadError> {
		match self {
			Self::ClaudeV3 | Self::ClaudeV47 | Self::ClaudeV5 | Self::ClaudeV5Sonnet | Self::Jev => {
				Ok(None)
			},
			_ => Ok(Some(tables::bpe_for(self)?.encode(text.units()))),
		}
	}
}

#[cfg(test)]
#[path = "tests"]
mod tests {
	#[path = "claude.rs"]
	mod claude;
	#[path = "deepseek.rs"]
	mod deepseek;
	#[path = "glm.rs"]
	mod glm;
	#[path = "jev.rs"]
	mod jev;
	#[path = "kimi.rs"]
	mod kimi;
	#[path = "openai.rs"]
	mod openai;
	#[path = "qwen.rs"]
	mod qwen;
}
