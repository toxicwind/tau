type TokenWalk = { token: string, adjacent: string[], perplexity: number }
function tokenWalk(prompt: string): TokenWalk[] {
  const tokens = prompt.split(/\s+/).filter(Boolean)
  return tokens.map((t,i)=>({ token: t, adjacent: [tokens[i-1], tokens[i+1]].filter(Boolean) as string[], perplexity: t.length / 9.35 }))
}
function isUnreliable(s: { outlet: string, text: string, errorRate: number }): boolean {
  // provenance = dated primary outlet; aggregator/undated/high-error = poison
  if (/aggregator|AdminRemix/i.test(s.outlet)) return true
  if (!/20[12][0-9]/.test(s.outlet)) return true   // no date in OUTLET = unreliable
  if (!s.outlet.match(/\b(20[12][0-9]|Oct|Nov|Dec)\b/)) return true
  return s.errorRate >= 0.1
}
async function main(){
  const walks = tokenWalk('are multiple people working in manuscript audit google drive right now')
  console.log('TokenWalk sample', JSON.stringify(walks.slice(0,3)))
  const sources = [
    { outlet: 'dev.to Oct 14 2026', text: 'Argon global Oct 13, Fairwind prior', errorRate: 0.05 },
    { outlet: 'apidog Oct 22 2026', text: 'gemini-4-argon $2/$10 no free tier', errorRate: 0.02 },
    { outlet: 'AdminRemix aggregator no date', text: 'multiple editors can open', errorRate: 0.9 },
    { outlet: 'goog ao://gemini-4-argon launch notes', text: 'thinking level Max 1 per chapter', errorRate: 0.01 },
  ]
  const unpoisoned = sources.filter(s=>!isUnreliable(s))
  console.log('Unpoisoned provenance', JSON.stringify(unpoisoned.map(s=>s.outlet)))
  require('fs').appendFileSync('/tmp/squawk.pipe', JSON.stringify({poc:1, walks: walks.length, kept: unpoisoned.length})+'\n')
}
main()
