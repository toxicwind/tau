# @tau/tau-stats

Local observability dashboard for AI usage statistics.

## Features

- **Session log parsing**: Reads JSONL session logs from `~/.tau/agent/sessions/`
- **SQLite aggregation**: Efficient stats storage and querying using `bun:sqlite`
- **Web dashboard**: Real-time metrics visualization with Chart.js
- **Incremental sync**: Only processes new/modified log entries

## Metrics Tracked

| Metric | Calculation |
|--------|-------------|
| Tokens/s | `output_tokens / (duration / 1000)` |
| Cache Rate | `cache_read / (input + cache_read) * 100` |
| Cache Savings | `(uncached prompt cost - actual prompt cost) / uncached prompt cost * 100` |
| Error Rate | `count(stopReason=error) / total_calls * 100` |
| API-equivalent estimate | Sum of token usage priced with the matching public API rate card |
| Avg Latency | Mean of `duration` |
| TTFT | Mean of `ttft` (time to first token) |

Subscription-backed models use matching public API prices when an exact public model exists; these values estimate API-equivalent usage rather than the architect's bill. Subscription-only models without a public price are reported as N/A and excluded from dollar totals.

// refused_by: modify_delete_guard · collision: none (no common ancestor text)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
## Usage

### Via CLI

```bash
# Start dashboard server (default: http://localhost:3847)
tau stats

# Custom port
tau stats --port 8080

# Print summary to console
tau stats --summary

# Output as JSON (for scripting)
tau stats --json
```

### Programmatic

```typescript
import { getDashboardStats, syncAllSessions } from "@tau/tau-stats";

// Sync session logs to database
const { processed, files } = await syncAllSessions();

// Get aggregated stats
const stats = await getDashboardStats();
console.log(stats.overall.totalCost);
console.log(stats.byModel[0].avgTokensPerSecond);
```

## API Endpoints

| Endpoint                    | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `GET /api/stats`            | Overall stats with all breakdowns                                    |
| `GET /api/stats/models`     | Per-model statistics                                                 |
| `GET /api/stats/folders`    | Per-folder/project statistics                                        |
| `GET /api/stats/timeseries` | Hourly time series data                                              |
| `GET /api/events`           | Server-sent live status: sync progress, data version, rollup backlog |
| `GET /api/status`           | Current live status (same shape as the events)                       |
| `POST /api/sync`            | Start a background sync; progress arrives on `/api/events`           |

## Data Storage

- **Session logs**: `~/.tau/agent/sessions/` (JSONL files)
- **Stats database**: `~/.tau/stats.db` (SQLite)

// refused_by: modify_delete_guard · collision: none (no common ancestor text)
## Dashboard

Pages: Overview, Models, Providers, Costs, Requests, Errors, Traces, Tools, Frustration, Projects and Gain. `1`–`6` pick the time range; `g` then a letter jumps to a page. Every page revalidates when the live data version moves, so there is no refresh button.

## License

MIT
