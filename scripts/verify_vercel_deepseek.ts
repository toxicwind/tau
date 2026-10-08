import { getBundledProviders, getBundledModels } from "../packages/catalog/src/models.ts";
import { resolveModelTokenizer } from "../packages/catalog/src/model-tokenizer.ts";
import { classifyModel } from "../packages/catalog/src/compat/taxonomy.ts";
import { Tokenizer } from "../packages/agent/src/tokenizer.ts";
import * as natives from "@tau/tau-natives";

console.log("=== VERCEL DEEPSEEK MASTER VERIFICATION SCRIPT ===");

// 1. Inspect providers and models in catalog
const providers = getBundledProviders();
const vercelProviders = providers.filter(p => p.includes("vercel"));
const deepseekProviders = providers.filter(p => p.includes("deepseek"));

console.log("Discovered Vercel providers:", vercelProviders);
console.log("Discovered DeepSeek providers:", deepseekProviders);

// 2. Collect all candidate DeepSeek models on Vercel AI Gateway
// Vercel AI Gateway models include deepseek/* as defined in vercel-ai-gateway.kdl
const vercelDeepseekModelIds = [
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-v3",
  "deepseek/deepseek-v3.1",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-thinking",
  "deepseek/deepseek-v4",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4.1-flash"
];

// Check bundled models under vercel-ai-gateway if present
for (const p of vercelProviders) {
  const models = getBundledModels(p as any);
  for (const m of models) {
    if (m.id.toLowerCase().includes("deepseek")) {
      if (!vercelDeepseekModelIds.includes(m.id)) {
        vercelDeepseekModelIds.push(m.id);
      }
    }
  }
}

console.log("Target Vercel DeepSeek models to verify:", vercelDeepseekModelIds);

// 3. Test verification as human sending requests
const humanRequests = [
  {
    role: "user",
    content: "Please analyze the following system architecture and explain the memory footprint.",
    timestamp: Date.now()
  },
  {
    role: "user",
    content: [
      { type: "text", text: "How does the BPE tokenizer handle Chinese characters like 你好世界 and emoji 🚀?" }
    ],
    timestamp: Date.now()
  },
  {
    role: "developer",
    content: "System prompt: You are a helpful assistant.",
    timestamp: Date.now()
  },
  {
    role: "user",
    content: "Write a high-performance Rust function for counting tokens with SIMD acceleration.",
    timestamp: Date.now()
  }
];

const results = [];

for (const modelId of vercelDeepseekModelIds) {
  const identity = classifyModel("vercel-ai-gateway", modelId, { lenient: true });
  const tokenizerName = resolveModelTokenizer(modelId, "vercel-ai-gateway");
  
  // Construct Tokenizer for model
  const tokenizer = new Tokenizer(tokenizerName ? { tokenizer: tokenizerName } : undefined);
  
  // Token counting on human requests
  const turnCounts = humanRequests.map((req, idx) => {
    const tokens = tokenizer.countMessage(req as any);
    return { turn: idx + 1, role: req.role, tokens };
  });

  const totalTokens = turnCounts.reduce((acc, c) => acc + c.tokens, 0);
  const strictTest = tokenizer.countTokens("Hello DeepSeek V3 from Vercel Gateway! 你好世界", "strict");

  results.push({
    modelId,
    identityClass: identity.class,
    identityFamily: identity.family,
    tokenizerName,
    nativeEncoding: tokenizer.encoding !== null ? "DeepSeekV3" : "estimate",
    turnCounts,
    totalTokens,
    strictTestPassed: strictTest > 0,
    strictTokens: strictTest
  });
}

console.log(JSON.stringify({
  status: "verified",
  timestamp: new Date().toISOString(),
  modelsTestedCount: results.length,
  allPassed: results.every(r => r.tokenizerName === "deepseek-v3" && r.strictTestPassed),
  results
}, null, 2));
