//! Offline reconstruction of `TypeSafe` Jev's input-token counts (`jev-1.13`).
//!
//! Jev reports only `usage.input_tokens`, so this model was recovered from
//! counts alone: ~639k probes against the live System One API, split into a
//! vocabulary by difference measurements inside neutral padding, then fitted
//! until every recorded count matched (see `data/README.md`). Like the
//! Claude families it reconstructs counts, not token ids.
//!
//! Pipeline for one `state` string:
//!
//! 1. NFC-normalize, then split with Qwen3.5's pre-tokenizer (single digits,
//!    contractions split off, combining marks glued to letters): the same
//!    [`Splitter::Qwen`] scanner and `nfc` flag as [`Encoding::Qwen3`].
//! 2. A piece that is a whole-word entry costs 1. The whole-word vocabulary is
//!    (almost exactly) the o200k tokens that are also Qwen3.5 tokens, plus
//!    every base token.
//! 3. Any other piece is cut into [`WINDOW`]-byte windows, and each window runs
//!    tiktoken's byte-pair merge with o200k ranks, restricted to a ~54k-token
//!    base subset of o200k. Whole-piece hits in the base table are *not*
//!    short-circuited ([`RankTable::count_merged`]): `token` is a whole word
//!    but not a base token, so `tokenize` costs 3.
//!
//! Counts are state *content*: the request frame (question text, template,
//! 269 tokens for a minimal one-noul request) is excluded, matching the
//! other families' "no chat-template frame" semantics.
//!
//! [`Encoding::Qwen3`]: crate::utok::Encoding::Qwen3

use crate::utok::{
	bpe::{BpeEncoding, BpeLoadError, OnceFallible, RankTable},
	pretoken::Splitter,
	utf::Unit,
};

/// Longest byte span one merge run covers: longer pieces are merged in
/// independent windows (measured: a random consonant run matches unwindowed
/// merging through 513 bytes and diverges at 514, and a Lao word gains a token
/// once it crosses byte 512 mid-character).
const WINDOW: usize = 512;

struct Jev {
	/// Base merge table (o200k ranks, non-base slots empty) plus the shared
	/// Qwen3.5 splitter and NFC contract.
	bpe:   BpeEncoding,
	/// Whole-word entries; only membership is read.
	whole: RankTable,
}

// `OnceFallible` rather than `LazyLock`: a corrupt blob caches as a typed
// error value here, where a `LazyLock` would poison unrecoverably and make
// every later call fail with the same useless message.
static JEV: OnceFallible<Jev, BpeLoadError> = OnceFallible::new();

fn load() -> Result<&'static Jev, BpeLoadError> {
	// Const-assert both blobs before anyone can observe a half-built model.
	// Const-assert both blobs: they ship and break together, and neither
	// may reach `parse` without a frame magic.
	const _: () = {
		macro_rules! assert_zstd {
			($name:literal, $path:literal) => {
				let bytes = include_bytes!($path);
				// `u8` compares are const-evaluable; `[u8; 4] != [u8; 4]` is not
				// (PartialEq is not const-stable), hence elementwise.
				if bytes.len() < 4
					|| bytes[0] != 0x28
					|| bytes[1] != 0xB5
					|| bytes[2] != 0x2F
					|| bytes[3] != 0xFD
				{
					panic!(concat!(
						"utok[",
						$name,
						"]: blob is missing the zstd frame magic (expected 28 B5 2F FD); a \
						 leading 28 EF BF BD means the bytes were lossily re-encoded as UTF-8 \
						 (every byte >= 0x80 replaced by U+FFFD). Restore from a clean source.",
					));
				}
			};
		}
		assert_zstd!("jev_base", "../../data/jev_base.bin.zst");
		assert_zstd!("jev_whole", "../../data/jev_whole.bin.zst");
	};
	// Both tables are the same family: they ship and break together.
	let base = RankTable::parse(include_bytes!("../../data/jev_base.bin.zst"), "jev_base")?;
	let whole = RankTable::parse(include_bytes!("../../data/jev_whole.bin.zst"), "jev_whole")?;
	JEV.get_or_try_init(|| {
		Ok(Jev {
			bpe:   BpeEncoding { table: base, splitter: Splitter::Qwen, nfc: true, ignore_merges: false },
			whole,
		})
	})
}

/// Jev input-token count of `units` (any UTF flavor) as state content,
/// excluding the request frame. Valid text counts flavor-invariantly.
pub fn content_token_count<U: Unit>(units: &[U]) -> Result<u32, BpeLoadError> {
	let jev = load()?;
	let mut n = 0u32;
	jev.bpe.run(units, &mut |base, piece| {
		n += if jev.whole.rank(piece).is_some() {
			1
		} else {
			piece.chunks(WINDOW).map(|w| base.count_merged(w)).sum()
		};
	});
	Ok(n)
}
