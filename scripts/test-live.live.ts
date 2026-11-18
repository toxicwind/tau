import { buildModel } from "@tau/tau-catalog/build";
const model = buildModel({
  id: "test-model", name: "test-model", api: "openai-completions",
  provider: "mimetite", baseUrl: "http://127.0.0.1:25193/v1",
  reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768, maxTokens: 256,
});
console.log("tau .live.ts test model:", model.id);
