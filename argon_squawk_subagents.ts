import { spawn } from 'child_process'
type SubAgent = { id: string, task: string, tokens: string[] }
const promptAsEmbedding = 'sovereign-notebook-adversaria argon-manuscript-audit 44 chapters 406842 words Zero escaped punctuation Metric SI'
function pseudoSubagent(tokens: string[]): SubAgent {
  return { id: 'pseudo-' + tokens[0], task: 'analyze ' + tokens.join(' '), tokens }
}
const tokenList = promptAsEmbedding.split(/\s+/)
const subs: SubAgent[] = []
for (let i = 0; i < 7; i++) {
  const slice = tokenList.slice(i * 3, i * 3 + 6)
  if (slice.length) subs.push(pseudoSubagent(slice))
}
for (const sa of subs) require('fs').appendFileSync('/tmp/squawk.pipe', JSON.stringify(sa) + '\n')
console.log('dispatched', subs.length, 'pseudo-embedding subagents:', subs.map(s=>s.id).join(','))
