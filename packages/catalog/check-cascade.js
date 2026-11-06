import rules from "./src/compat/rules.json";
console.log("total rules:", rules.rules.length);
const omitRules = rules.rules.filter((r) => JSON.stringify(r).includes("omitMaxOutputTokens"));
console.log("omit rules:", omitRules.length);
if (omitRules.length > 0) {
    console.log("first omit rule:", JSON.stringify(omitRules[0]).slice(0, 300));
}
