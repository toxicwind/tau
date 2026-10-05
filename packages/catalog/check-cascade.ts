import { resolveCascade } from "./src/compat/cascade";
import rules from "./src/compat/rules.json";

console.log("total rules:", (rules as any).rules.length);
const omitRules = (rules as any).rules.filter((r: any) =>
  JSON.stringify(r).includes("omitMaxOutputTokens")
);
console.log("omit rules:", omitRules.length);
if (omitRules.length > 0) {
  console.log("first omit rule:", JSON.stringify(omitRules[0]).slice(0, 300));
}
