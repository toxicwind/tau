import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * On-demand tree-sitter WebAssembly grammar catalog, ported from the upstream
 * stencil-hq/wasm-grammars v1 release manifest (real decompressed-wasm sizes
 * and SHA-256 digests). The native addon lazily loads `<grammars dir>/<file>`
 * for less-common languages; the install machinery in the coding agent places a
 * verified `.wasm` there. Resolving is data-only and side-effect free.
 */

/** Metadata for one installable WebAssembly tree-sitter grammar. */
export interface WasmGrammarInfo {
	language: string;
	/** Uncompressed `.wasm` filename the addon loads (`<grammars dir>/<file>`). */
	file: string;
	/** GitHub release tag the zstd asset is attached to. */
	release: string;
	/** Decompressed wasm byte length (download integrity check). */
	size: number;
	/** Decompressed wasm SHA-256 (download integrity check). */
	sha256: string;
	/** Whether `<grammars dir>/<file>` already exists on disk. */
	installed?: boolean;
}

/** Resolver input: a `lang` alias/name, or a file `path` whose extension picks the grammar. */
export interface WasmGrammarQuery {
	lang?: string;
	path?: string;
}

const GRAMMARS: readonly WasmGrammarInfo[] = [
{ language: "astro", file: "astro-612c83b88b97ba7c.wasm", release: "v1", size: 24622, sha256: "612c83b88b97ba7cc53a4808aebf71196442d2aea70955333b114212b771a4d7" },
{ language: "clojure", file: "clojure-f63ecd31939b06c3.wasm", release: "v1", size: 97934, sha256: "f63ecd31939b06c315c49794a628059b6f16de191a17b148a290e5f8faffbc0a" },
{ language: "cmake", file: "cmake-38a05d65733bf24f.wasm", release: "v1", size: 75504, sha256: "38a05d65733bf24f4469b01d644d6b8e26e779fcc40ae562037dd699aee6e103" },
{ language: "csharp", file: "csharp-f265130d20fe62d3.wasm", release: "v1", size: 5328197, sha256: "f265130d20fe62d3dc0cec756ee5a4159bd9825894a48fc0f7e72c8bd30ef099" },
{ language: "dart", file: "dart-52bdbf469a2343a5.wasm", release: "v1", size: 1269300, sha256: "52bdbf469a2343a52385f75dab61097fe9c157e747ddfcc52200c153c4259d4b" },
{ language: "dockerfile", file: "dockerfile-6d95cfe08d32ad32.wasm", release: "v1", size: 48699, sha256: "6d95cfe08d32ad32cd4e3e13e209f03ae59fbd495ad61014e1873fbbbb6c5078" },
{ language: "elixir", file: "elixir-1160c3b90a7c1eb7.wasm", release: "v1", size: 1412268, sha256: "1160c3b90a7c1eb7cb8f8e5c3a1960db3219c97c10fa21b1421b79142cc2e556" },
{ language: "emacs-lisp", file: "emacs-lisp-d4fee941a25f6464.wasm", release: "v1", size: 52513, sha256: "d4fee941a25f646467cebe60317f46eb0f47b617c76fb9a1a60e7e7982b43415" },
{ language: "erlang", file: "erlang-bb8809212393e686.wasm", release: "v1", size: 418478, sha256: "bb8809212393e68687d0f2bc1309c4ca7601fa704a8a96edaffaa34585f1b1b7" },
{ language: "fortran", file: "fortran-f72872963184cdb4.wasm", release: "v1", size: 6591350, sha256: "f72872963184cdb4ccb623be3e4e40606066a317be6d5d61cdc929b51bba6d22" },
{ language: "graphql", file: "graphql-fd4081c84308f5db.wasm", release: "v1", size: 57563, sha256: "fd4081c84308f5db14a4a6e1bea91c08f9c38e5ab47e5a0730c4a39448844d00" },
{ language: "haskell", file: "haskell-ddc4978970326bc4.wasm", release: "v1", size: 3805634, sha256: "ddc4978970326bc46369f3dff15027c54dac79adb7aca9ba7b6d3a20ebb1b3e0" },
{ language: "hcl", file: "hcl-1b4b186da007c489.wasm", release: "v1", size: 93351, sha256: "1b4b186da007c48980f7ec7259b15edb2ea6cb1b8cf7ad01d5c9c39456aa52fb" },
{ language: "ini", file: "ini-4884a74e0e60d02f.wasm", release: "v1", size: 4710, sha256: "4884a74e0e60d02fc897b1f780c044e578ff839c9eeb6f4742d2feaef9839ece" },
{ language: "julia", file: "julia-78d8e1aa3b207c29.wasm", release: "v1", size: 6223351, sha256: "78d8e1aa3b207c290631bbb071ebbe20f91d631e91dd2d78a71358472660978a" },
{ language: "just", file: "just-989d19dab6b34933.wasm", release: "v1", size: 44632, sha256: "989d19dab6b349337e0335e8f8bfe39de40f27639dc34c23a0d8c63678a69e68" },
{ language: "kotlin", file: "kotlin-83d1aa9580f91a32.wasm", release: "v1", size: 5772696, sha256: "83d1aa9580f91a32b51a057ad4216166c29e488bf750aa891ae528f7a04dd4bf" },
{ language: "lua", file: "lua-83446c583739247d.wasm", release: "v1", size: 53205, sha256: "83446c583739247d74ae0953a1844b642fc126a5e773b797ecd0f7b5af686c84" },
{ language: "make", file: "make-c2a057ef58739b2f.wasm", release: "v1", size: 147044, sha256: "c2a057ef58739b2f8025bc3f7d04a62ae3daad8aeb7979b2db6097800950cded" },
{ language: "nix", file: "nix-10a66e15b62be1a5.wasm", release: "v1", size: 79503, sha256: "10a66e15b62be1a59cd256abf4b48fdeac07e50c0a8e50ceb64296fcec019930" },
{ language: "objc", file: "objc-ede2d58688f085d4.wasm", release: "v1", size: 5317156, sha256: "ede2d58688f085d4d36ccdf7f2b50aa61f70ea4f134dd3741c23ad857473a148" },
{ language: "ocaml", file: "ocaml-c60bd9980a698106.wasm", release: "v1", size: 5553927, sha256: "c60bd9980a698106c09dccf5a089841e7d285721ad8ce9e4fd5a326bf3316d0f" },
{ language: "odin", file: "odin-0fa018a7182e62a6.wasm", release: "v1", size: 2215304, sha256: "0fa018a7182e62a6414379018fb1bbe2e46ca39f6f1cd6584a4609481c1f303e" },
{ language: "php", file: "php-cb7397cba44a21ce.wasm", release: "v1", size: 1002409, sha256: "cb7397cba44a21ce6882d8173c597d66e32a257cb1f628ba45cdf23f9d8d7c6a" },
{ language: "powershell", file: "powershell-2a24f946f96e67ac.wasm", release: "v1", size: 990743, sha256: "2a24f946f96e67ac812fb6c7d647576a033febc0c48f4c91a340b549e7eac73d" },
{ language: "protobuf", file: "protobuf-0b226f4132ac4493.wasm", release: "v1", size: 73836, sha256: "0b226f4132ac4493642b8df1fbeb7541c92e36e3fb152064ef662d072135b795" },
{ language: "r", file: "r-908227b85fae8f37.wasm", release: "v1", size: 484429, sha256: "908227b85fae8f37660f9991110349a2ce6ecde650549c8a72cda800caa5e948" },
{ language: "ruby", file: "ruby-e77f88559b47c0fe.wasm", release: "v1", size: 2106322, sha256: "e77f88559b47c0fe2771821c6c160cdf6bbfe17afcd642ab3fdda9aebb70b2f3" },
{ language: "scala", file: "scala-f1699072abf3668a.wasm", release: "v1", size: 3922744, sha256: "f1699072abf3668a995ece3950a52c00f9da168a58684fe104e98214b0a74903" },
{ language: "solidity", file: "solidity-ac4d44dc54b7a475.wasm", release: "v1", size: 508585, sha256: "ac4d44dc54b7a475c2284ae27ab0af932043e2cfd4e200a416b2ac5d40f433d7" },
{ language: "sql", file: "sql-f9d5638965f6f7ec.wasm", release: "v1", size: 2433442, sha256: "f9d5638965f6f7ecc6b6979b8717f44e756687a1cbe4fef411b84506bdb81451" },
{ language: "starlark", file: "starlark-1f892a95b3d42e69.wasm", release: "v1", size: 329944, sha256: "1f892a95b3d42e69e71eeb3efdba3cc605a5c8b221b554e250f5418c64c682a6" },
{ language: "svelte", file: "svelte-03ab329192177443.wasm", release: "v1", size: 44859, sha256: "03ab329192177443c91eaf0904b011089cc6b779df1792468afd379c0a6a2512" },
{ language: "swift", file: "swift-92a6aa39712255e7.wasm", release: "v1", size: 3726992, sha256: "92a6aa39712255e7332d1b06db52bc6d49e9f563215846978c0ca63b6cc38359" },
{ language: "tlaplus", file: "tlaplus-2bb6711906017f86.wasm", release: "v1", size: 4878580, sha256: "2bb6711906017f861d3c143553c5077fc167f29d023a606a5dcfc159efb9e5bc" },
{ language: "verilog", file: "verilog-46f723039630ef85.wasm", release: "v1", size: 18135336, sha256: "46f723039630ef85b8a2dd324cba2673207163f760eb435c800bc0f56d78bb0e" },
{ language: "vue", file: "vue-a9b2b4573afa0f31.wasm", release: "v1", size: 28095, sha256: "a9b2b4573afa0f31a878753a30e2cda2030baa26544159448da6ba8c69bfa76d" },
{ language: "xml", file: "xml-fafa7327c7a09ba7.wasm", release: "v1", size: 46968, sha256: "fafa7327c7a09ba74612e23543ff4e93ee08b785f0a8c2f8292c03f0b65c4917" },
{ language: "zig", file: "zig-4dd568b541381b9d.wasm", release: "v1", size: 691729, sha256: "4dd568b541381b9ddcd0b53eda9956d26fea148b26f0af2ec52b1e8b4de3ed2e" },

];

/** Build an alias set for one grammar: language name, hyphen/underscore-stripped name, and lowercased form. */
const BY_ALIAS: ReadonlyMap<string, WasmGrammarInfo> = new Map(
	GRAMMARS.flatMap(info => {
		const names = [info.language, info.language.replace(/[-_]/g, ""), info.language.toLowerCase()];
		return [...new Set(names)].map(n => [n, info] as const);
	}),
);

/** Directory the native addon reads (and grammars install into): `~/.tau/grammars`. */
export function getNativeGrammarsDir(): string {
	return path.join(os.homedir(), ".tau", "grammars");
}

/** Resolve a query to its grammar metadata, or undefined when it is not a wasm-backed language. */
export function wasmGrammarFor(query: WasmGrammarQuery): WasmGrammarInfo | undefined {
	let key = query.lang?.trim().toLowerCase();
	if (!key && query.path) {
		const base = path.basename(query.path).toLowerCase();
		key = base.startsWith(".") ? base : path.extname(base);
	}
	const info = key ? BY_ALIAS.get(key) ?? BY_ALIAS.get(key.replace(/[-_]/g, "")) : undefined;
	if (!info) return undefined;
	return { ...info, installed: info.installed === true || fs.existsSync(path.join(getNativeGrammarsDir(), info.file)) };
}
