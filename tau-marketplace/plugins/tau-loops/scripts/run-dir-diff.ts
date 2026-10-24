import { censusConsumers, diffTrees, formatCensus, formatDiff, resolveDir } from "../src/dir-diff.ts";

const [leftArg, rightArg, ...needles] = process.argv.slice(2);
if (leftArg === undefined || rightArg === undefined) {
	throw new Error("usage: run-dir-diff.ts <leftDir> <rightDir> [consumerNeedle...]");
}

const left = resolveDir(leftArg);
const right = resolveDir(rightArg);
const diff = diffTrees(left, right);
process.stdout.write(`dir-diff ${left} <-> ${right}\n${formatDiff(diff)}\n`);

if (needles.length > 0) {
	const hits = censusConsumers({
		searchRoot: resolveDir(process.env.LOOPS_SEARCH_ROOT ?? "/home/toxic/estate"),
		needles,
		maxHitsPerNeedle: 20,
	});
	process.stdout.write(`\n${formatCensus(hits)}`);
}
