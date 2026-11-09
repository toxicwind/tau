/**
 * Exa Web Search Provider
 *
 * High-quality neural search via Exa Search API.
 * Returns structured search results with optional content extraction.
 * Requests per-result summaries via `contents.summary` and synthesizes
 * them into a combined `answer` string on the SearchResponse.
 */
import { type ApiKey, type AuthStorage, type FetchImpl, getEnvApiKey, withAuth } from "@tau/tau-ai";
import { isRecord } from "@tau/tau-utils";
import { getDefault, settings } from "../../../config/settings";
import { findApiKey, isSearchResponse } from "../../../exa/mcp-client";
