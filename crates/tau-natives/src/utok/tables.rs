//! Lazily-decoded embedded tables and per-family wiring.
//!
//! # Hardening doctrine
//!
//! Embedded BPE blobs get the same treatment Morphe gives obfuscated
//! bytecode: anchor on the most stable structure, resolve it as early as
//! possible, and fail loud when the anchor does not match. Anchoring on the
//! zstd frame magic (`28 B5 2F FD`) rather than on a filename or a byte
//! length is the same move as anchoring a Fingerprint on a surviving string
//! literal instead of a method name.
//!
//! Four independent layers, each answering a failure mode of the 2026-10-02
//! incident (commit `e0518234b5` re-encoded `deepseek3.bin.zst` through a
//! lossy UTF-8 transcoder, replacing every byte >= 0x80 with `ef bf bd`;
//! the corrupt file shipped, `LazyLock::new` panicked inside
//! [`RankTable::parse`], and every rayon worker's `count_tokens` then
//! panicked with the same useless "previously been poisoned" message):
//!
//! 1. **A module-scope `const _` assertion** in [`bpe_table!`] checks the
//!    blob's zstd magic while rustc is still building the crate. Module
//!    scope specifically, because a const assertion inside a generic
//!    function is not evaluated under `cargo check` (trybuild#225).
//! 2. **`build.rs`** walks the decompressed piece table of every blob before
//!    the crate compiles, catching truncation the magic check cannot see.
//! 3. **[`OnceFallible`]** caches a failed load as a value. `LazyLock`
//!    poisoning is unrecoverable by design, which is what turned one bad
//!    blob into a process-wide cascade.
//! 4. **`tests/compile_fail.rs`** ships a blob with the exact corruption
//!    signature and asserts the build rejects it. A safety mechanism nobody
//!    has watched fire is a hypothesis, not a check.
//!
//! Layers 1, 2 and 4 are what make layer 3 unreachable in practice; layer 3
//! exists so that "in practice" failing produces one typed error instead of
//! hundreds of identical backtraces.

// Re-exported so `mod.rs` and this module's tests can name the error without
// reaching into the private `bpe` module.
pub use crate::utok::bpe::BpeLoadError;
// Only `load_tests` names `OnceFallible` directly; release builds reach it
// through `bpe_table!`.
#[cfg(test)]
pub use crate::utok::bpe::OnceFallible;

use crate::utok::{
	Encoding,
	bpe::BpeEncoding,
	pretoken::Splitter,
};
#[cfg(test)]
use crate::utok::bpe::RankTable;

/// Declare a lazily-loaded BPE table backed by a zstd-compressed
/// `include_bytes!`'d blob.
///
/// Emits, in order:
///
/// 1. A module-scope `const _` block asserting the blob begins with the
///    zstd frame magic. Evaluated by rustc, so a corrupt blob fails the
///    build before a single line of runtime code exists.
/// 2. A `static` [`OnceFallible`] slot.
/// 3. An `#[inline]` accessor returning `Result<&'static BpeEncoding,
///    BpeLoadError>`, resolving and caching the decode on first call.
///
/// Paths are `$crate`-qualified so the macro works from the trybuild
/// witness crate, which expands it outside this crate.
#[macro_export]
macro_rules! bpe_table {
	(
		$(#[$attr:meta])*
		$vis:vis static $static:ident,
		$accessor:ident,
		$path:literal,
		$family:literal,
		$feature:literal,
		$splitter:expr,
		$nfc:expr,
		$ignore_merges:expr
	) => {
		$(#[$attr])*
		#[cfg(feature = $feature)]
		$vis static $static: $crate::utok::bpe::OnceFallible<
			$crate::utok::bpe::BpeEncoding,
			$crate::utok::bpe::BpeLoadError,
		> = $crate::utok::bpe::OnceFallible::new();

		#[cfg(feature = $feature)]
		const _: () = {
			let bytes = include_bytes!($path);
			if bytes.len() < 4 {
				panic!(concat!(
					"BPE blob too short for a zstd frame magic: ",
					$path,
					" (usually a truncated checkout or an interrupted write)",
				));
			}
			// Elementwise: `[u8; 4] != [u8; 4]` is not const-evaluable
			// (PartialEq is not const-stable), but `u8` compares are.
			if bytes[0] != 0x28 || bytes[1] != 0xB5 || bytes[2] != 0x2F || bytes[3] != 0xFD {
				panic!(concat!(
					"BPE blob is missing the zstd frame magic (expected 28 B5 2F FD): ",
					$path,
					" — a leading 28 EF BF BD means the bytes were lossily re-encoded as \
					 UTF-8 (every byte >= 0x80 replaced by U+FFFD), which is how \
					 data/deepseek3.bin.zst was destroyed on 2026-10-02 by commit e0518234b5. \
					 Restore the blob from a clean source.",
				));
			}
		};

		#[cfg(feature = $feature)]
		#[inline]
		#[must_use = "a BPE table load can fail; handle the Result"]
		$vis fn $accessor() -> ::core::result::Result<
			&'static $crate::utok::bpe::BpeEncoding,
			$crate::utok::bpe::BpeLoadError,
		> {
			$static.get_or_try_init(|| {
				$crate::utok::bpe::RankTable::parse(include_bytes!($path), $family).map(|table| {
					$crate::utok::bpe::BpeEncoding {
						table,
						splitter: $splitter,
						nfc: $nfc,
						ignore_merges: $ignore_merges,
					}
				})
			})
		}
	};
}

// ── OpenAI ──────────────────────────────────────────────────────────────
// Codepoint scanners in src/scan/{o200k,cl100k}.rs, hand-ported from the
// tiktoken-rs 0.7.0 patterns (src/tiktoken_ext/openai_public.rs, identical
// to openai/tiktoken tiktoken_ext/openai_public.py) and differential-tested
// against tiktoken-rs in tests/openai.rs.

bpe_table!(
	pub(crate) static O200K_BASE,
	o200k_base,
	"../../data/o200k_base.bin.zst",
	"o200k_base",
	"family-o200k",
	Splitter::O200k,
	false,
	false
);

bpe_table!(
	pub(crate) static CL100K_BASE,
	cl100k_base,
	"../../data/cl100k_base.bin.zst",
	"cl100k_base",
	"family-cl100k",
	Splitter::Cl100k,
	false,
	false
);

// ── Qwen3 ───────────────────────────────────────────────────────────────
// Pattern: qwen3.8.tokenizer.json pre_tokenizer Split regex, verified equal
// to data/families.json qwen3.pre. Note `\p{N}` matches a SINGLE digit
// (unlike cl100k's {1,3}) and letters admit trailing marks `[\p{L}\p{M}]+`.
// Normalizer is NFC (`nfc: true`). The pack (tools/pack-qwen.ts) empties the
// 201 merge-unreachable vocab slots so the engine's whole-piece
// short-circuit cannot emit ids the HF reference (ignore_merges=false)
// never produces.

/// Reference regex, kept as the scanner's dev/test differential oracle
/// (see `scan::qwen` tests).
#[cfg(all(test, feature = "family-qwen3"))]
pub(crate) const QWEN3_PATTERN: &str = r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?[\p{L}\p{M}]+|\p{N}| ?[^\s\p{L}\p{M}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+";

bpe_table!(
	pub(crate) static QWEN3,
	qwen3,
	"../../data/qwen3.bin.zst",
	"qwen3",
	"family-qwen3",
	Splitter::Qwen,
	true,
	false
);

// ── DeepSeek ────────────────────────────────────────────────────────────
// Three-stage HF Split(Isolated) chain from data/families.json deepseek3
// (cache/deepseek-v4.tokenizer.json pre_tokenizer; base BPE identical
// V3..V4): digits <=3, then CJK runs (Han + hiragana + katakana blocks),
// then the main pattern with a punctuation-prefix-letters alternate.
//
// This is the blob destroyed by commit e0518234b5 on 2026-10-02. Layers 1,
// 2 and 4 above exist because that corruption shipped undetected and took
// down every rayon worker at once.

/// Stage patterns kept as the dev/test differential reference for the
/// scanner (`scan::deepseek`).
#[cfg(all(test, feature = "family-deepseek3"))]
pub(crate) const DEEPSEEK_STAGE_DIGITS: &str = r"\p{N}{1,3}";
#[cfg(all(test, feature = "family-deepseek3"))]
pub(crate) const DEEPSEEK_STAGE_CJK: &str = "[一-龥぀-ゟ゠-ヿ]+";
#[cfg(all(test, feature = "family-deepseek3"))]
pub(crate) const DEEPSEEK_STAGE_MAIN: &str = concat!(
	r##"[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~][A-Za-z]+"##,
	r"|[^\r\n\p{L}\p{P}\p{S}]?[\p{L}\p{M}]+",
	r"| ?[\p{P}\p{S}]+[\r\n]*",
	r"|\s*[\r\n]+",
	r"|\s+(?!\S)",
	r"|\s+",
);

bpe_table!(
	pub(crate) static DEEPSEEK3,
	deepseek3,
	"../../data/deepseek3.bin.zst",
	"deepseek3",
	"family-deepseek3",
	Splitter::DeepSeek,
	false,
	false
);

// ── Kimi ────────────────────────────────────────────────────────────────
// Runtime split: hand-written scanner (`scan::kimi`), a port of the
// tokenization_kimi.py pat_str (8-alternate join, class intersection
// `&&[^\p{Han}]`, `\s+(?!\S)` lookahead). The regex below is kept as the
// dev/test differential reference; it is verified equal to
// data/families.json kimi_k2.pattern.

#[cfg(all(test, feature = "family-kimi"))]
pub(crate) const KIMI_K2_PATTERN: &str = concat!(
	r"[\p{Han}]+",
	r"|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]*[\p{Ll}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
	r"|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]+[\p{Ll}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
	r"|\p{N}{1,3}",
	r"| ?[^\s\p{L}\p{N}]+[\r\n]*",
	r"|\s*[\r\n]+",
	r"|\s+(?!\S)",
	r"|\s+",
);

bpe_table!(
	pub(crate) static KIMI_K2,
	kimi_k2,
	"../../data/kimi_k2.bin.zst",
	"kimi_k2",
	"family-kimi",
	Splitter::Kimi,
	false,
	false
);

// ── GLM ─────────────────────────────────────────────────────────────────
// Pattern: glm-5.tokenizer.json pre_tokenizer Split regex, verified equal
// to data/families.json glm5.pre — and character-identical to tiktoken's
// cl100k_base pattern, so the runtime splitter aliases the cl100k scanner
// (`scan::cl100k`) instead of duplicating it; `glm_scan_tests` below proves
// byte-identical piece boundaries against the GLM reference regex.
// `ignore_merges: true` — whole-piece vocab hits bypass merging; the
// engine's encode_piece short-circuit implements exactly this (proven by
// directed fixtures: greedy-merge-unreachable tokens like ' 参考' encode
// as one id).

/// Reference regex, kept as the dev/test differential oracle for the
/// cl100k-scanner alias.
#[cfg(all(test, feature = "family-cl100k", feature = "family-glm"))]
pub(crate) const GLM5_PATTERN: &str = r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+";

bpe_table!(
	pub(crate) static GLM5,
	glm5,
	"../../data/glm5.bin.zst",
	"glm5",
	"family-glm",
	Splitter::Cl100k,
	false,
	true
);

/// Resolve the BPE encoding for a family that stores a rank table.
///
/// `Err` here is always a build or configuration defect, never a runtime
/// condition: either the family is count-only (Claude, Jev — routed
/// elsewhere in `mod.rs`), or its cargo feature was disabled so its blob
/// was never linked.
#[inline]
#[must_use = "handle the Result; a missing BPE table must not be silently ignored"]
pub(crate) fn bpe_for(enc: Encoding) -> Result<&'static BpeEncoding, BpeLoadError> {
	match enc {
		#[cfg(feature = "family-o200k")]
		Encoding::O200kBase => o200k_base(),
		#[cfg(feature = "family-cl100k")]
		Encoding::Cl100kBase => cl100k_base(),
		#[cfg(feature = "family-qwen3")]
		Encoding::Qwen3 => qwen3(),
		#[cfg(feature = "family-deepseek3")]
		Encoding::DeepSeekV3 => deepseek3(),
		#[cfg(feature = "family-kimi")]
		Encoding::KimiK2 => kimi_k2(),
		#[cfg(feature = "family-glm")]
		Encoding::Glm5 => glm5(),
		// Count-only families: Claude reconstructs counts from a measured
		// ctok vocabulary, Jev from its own whole-word model. Neither has a
		// rank table and neither can reach this function.
		Encoding::ClaudeV3
		| Encoding::ClaudeV47
		| Encoding::ClaudeV5
		| Encoding::ClaudeV5Sonnet
		| Encoding::Jev => Err(BpeLoadError::CountOnlyFamily { variant: enc }),
		// The remaining arms exist only when some family feature is off, so
		// the match stays exhaustive and the caller gets a typed reason
		// instead of an `unreachable!` panic.
		#[allow(unreachable_patterns)]
		disabled => Err(BpeLoadError::FamilyDisabled {
			variant: disabled,
			feature: "family-*",
		}),
	}
}

#[cfg(test)]
mod load_tests {
	//! Layer 3's regression net: every linked table must decode, and a
	//! failed decode must be a reusable value rather than a poison.

	use super::*;

	#[test]
	fn every_linked_table_loads() {
		let mut linked = 0usize;
		let mut check = |name: &str, r: Result<&BpeEncoding, BpeLoadError>| {
			let enc = r.unwrap_or_else(|e| panic!("{name} failed to load: {e}"));
			assert!(enc.table.max_token_len > 0, "{name}: empty vocabulary");
			linked += 1;
		};
		#[cfg(feature = "family-o200k")]
		check("o200k_base", o200k_base());
		#[cfg(feature = "family-cl100k")]
		check("cl100k_base", cl100k_base());
		#[cfg(feature = "family-qwen3")]
		check("qwen3", qwen3());
		#[cfg(feature = "family-deepseek3")]
		check("deepseek3", deepseek3());
		#[cfg(feature = "family-kimi")]
		check("kimi_k2", kimi_k2());
		#[cfg(feature = "family-glm")]
		check("glm5", glm5());
		assert!(linked > 0, "no family feature is enabled");
	}

	/// The incident's root cause, stated as a test: a failing initializer
	/// runs exactly once and every later caller sees the same typed error.
	#[test]
	fn once_fallible_caches_failure_instead_of_poisoning() {
		use std::sync::atomic::{AtomicUsize, Ordering};

		static CALLS: AtomicUsize = AtomicUsize::new(0);
		static SLOT: OnceFallible<u32, &'static str> = OnceFallible::new();

		let first = SLOT.get_or_try_init(|| {
			CALLS.fetch_add(1, Ordering::SeqCst);
			Err("boom")
		});
		let second = SLOT.get_or_try_init(|| {
			CALLS.fetch_add(1, Ordering::SeqCst);
			Err("boom")
		});

		assert_eq!(first, Err("boom"));
		assert_eq!(second, Err("boom"));
		assert_eq!(CALLS.load(Ordering::SeqCst), 1, "initializer ran more than once");
	}

	#[test]
	fn bpe_for_rejects_count_only_families() {
		for family in [
			Encoding::ClaudeV3,
			Encoding::ClaudeV47,
			Encoding::ClaudeV5,
			Encoding::ClaudeV5Sonnet,
			Encoding::Jev,
		] {
			match bpe_for(family) {
				Err(BpeLoadError::CountOnlyFamily { variant }) => assert_eq!(variant, family),
				other => panic!("expected CountOnlyFamily for {family:?}, got {other:?}"),
			}
		}
	}

	/// Malformed input must produce the typed error, never a panic. These
	/// are the shapes the 2026-10-02 corruption would have taken had the
	/// outer frame survived while the payload did not.
	#[test]
	fn parse_rejects_malformed_blobs_without_panicking() {
		assert!(matches!(
			RankTable::parse(&[], "empty"),
			Err(BpeLoadError::Zstd { .. })
		));
		assert!(matches!(
			RankTable::parse(b"not a zstd frame at all", "garbage"),
			Err(BpeLoadError::Zstd { .. })
		));
	}

	/// A zstd frame that decodes but is not a UTOK1 container, and one that
	/// is a UTOK1 header with a truncated body.
	#[test]
	fn parse_rejects_bad_envelopes() {
		let not_utok = zstd::encode_all(b"XXXXXXXXXX".as_slice()).unwrap();
		match RankTable::parse(&not_utok, "not-utok") {
			Err(BpeLoadError::BadMagic { family, got }) => {
				assert_eq!(family, "not-utok");
				assert_eq!(&got, b"XXXXXX");
			},
			other => panic!("expected BadMagic, got {other:?}"),
		}

		let short = zstd::encode_all(b"UTOK".as_slice()).unwrap();
		assert!(matches!(RankTable::parse(&short, "short"), Err(BpeLoadError::Truncated { .. })));

		let mut body = b"UTOK1\n".to_vec();
		body.extend_from_slice(&4u32.to_le_bytes());
		body.extend_from_slice(&[0x08, 0x61, 0x62]); // len 8, then only 2 bytes
		let truncated = zstd::encode_all(body.as_slice()).unwrap();
		assert!(matches!(
			RankTable::parse(&truncated, "truncated"),
			Err(BpeLoadError::TruncatedPiece { .. })
		));

		let mut trailing = b"UTOK1\n".to_vec();
		trailing.extend_from_slice(&0u32.to_le_bytes());
		trailing.extend_from_slice(b"junk");
		let with_trailing = zstd::encode_all(trailing.as_slice()).unwrap();
		assert!(matches!(
			RankTable::parse(&with_trailing, "trailing"),
			Err(BpeLoadError::TrailingBytes { count: 4, .. })
		));
	}
}

#[cfg(all(test, feature = "family-cl100k", feature = "family-glm"))]
mod glm_scan_tests {
	//! Differential justifying the cl100k-scanner alias: piece boundaries
	//! from `Splitter::Cl100k` vs the GLM-5 reference regex, over the
	//! corpus, every glm5 fixture text, and seeded random CJK/Latin mixes.

	use super::GLM5_PATTERN;
	use crate::utok::pretoken::Splitter;

	/// splitmix64 (same scheme as tests/openai.rs).
	struct Rng(u64);

	impl Rng {
		fn next(&mut self) -> u64 {
			self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
			let mut z = self.0;
			z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
			z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
			z ^ (z >> 31)
		}
	}

	fn random_strings(seed: u64, n: usize) -> Vec<String> {
		let mut rng = Rng(seed);
		let mut out = Vec::with_capacity(n * 2);
		for _ in 0..n {
			let len = (rng.next() % 300 + 1) as usize;
			let bytes: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
			out.push(String::from_utf8_lossy(&bytes).into_owned());
		}
		for _ in 0..n {
			let len = (rng.next() % 120 + 1) as usize;
			let s: String = (0..len)
				.map(|_| {
					let c = match rng.next() % 8 {
						0 => rng.next() % 0x80,                          // ASCII
						1 => 0x20 + rng.next() % 4,                      // spaces/punct
						2 => rng.next() % 0x250,                         // Latin+ext
						3 => 0x4e00 + rng.next() % 0x100,                // CJK
						4 => 0x1f300 + rng.next() % 0x100,               // emoji
						5 => 0x300 + rng.next() % 0x70,                  // combining marks
						6 => [9, 10, 13, 32][(rng.next() % 4) as usize], // whitespace
						_ => rng.next() % 0x11_0000,
					};
					char::from_u32(c as u32).unwrap_or('\u{fffd}')
				})
				.collect();
			out.push(s);
		}
		out
	}

	#[test]
	fn glm_cl100k_alias_matches_reference_regex() {
		let reference = Splitter::new(&[GLM5_PATTERN]);
		let scanner = Splitter::Cl100k;
		let corpus: Vec<String> =
			serde_json::from_str(include_str!("../../fixtures/corpus.json")).unwrap();
		let fixture: serde_json::Value =
			serde_json::from_str(include_str!("../../fixtures/glm5.json")).unwrap();
		let fixture_texts: Vec<String> = fixture["cases"]
			.as_array()
			.unwrap()
			.iter()
			.map(|c| c["text"].as_str().unwrap().to_string())
			.collect();
		let texts: Vec<String> = corpus
			.into_iter()
			.chain(fixture_texts)
			.chain(random_strings(0x61c8_8646, 400))
			.collect();
		for text in &texts {
			assert_eq!(
				scanner.split(text),
				reference.split(text),
				"piece boundaries diverge on {text:?}"
			);
		}
	}
}
