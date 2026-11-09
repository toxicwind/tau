---
name: authoring-marketplaces
description: Use when creating a new tau marketplace. Covers marketplace.json schema, source types, install commands, and publishing.
---

# Authoring Marketplaces

A marketplace is a Git repository (or local directory) that contains a catalog file at either `.tau-plugin/marketplace.json` (preferred for tau-specific catalogs) or `.claude-plugin/marketplace.json` (Claude Code-compatible; used as the fallback). Anyone can author one. Users add it with `/marketplace add owner/repo` and then install individual plugins from it.

## Minimum viable marketplace

```
my-marketplace/
  .claude-plugin/
    marketplace.json
  plugins/
    my-plugin/
      skills/
        my-skill/
          SKILL.md
```

```json
{
	"name": "my-marketplace",
	"owner": { "name": "Your Name" },
	"plugins": [
		{
			"name": "my-plugin",
			"description": "What it does",
			"source": "./plugins/my-plugin"
		}
	]
}
```

Push to GitHub. Users install with:

```
/marketplace add your-github-username/my-marketplace
/marketplace install my-plugin@my-marketplace
```

## marketplace.json schema

The catalog file lives at either `.tau-plugin/marketplace.json` or `.claude-plugin/marketplace.json` in the repository root. tau prefers the `.tau-plugin/` path and falls back to the Claude path; a repository may publish both to expose tool-specific catalogs from a single source tree.

### Top-level fields

| Field                  | Required | Description                                                                                                                                                |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                 | yes      | Marketplace name. ASCII alphanumeric, hyphens, dots. Must start and end with alphanumeric. Max 64 chars. Case-equivalent marketplace names cannot coexist. |
| `owner`                | yes      | Object with at minimum `owner.name` (string)                                                                                                               |
| `owner.name`           | yes      | Marketplace owner name                                                                                                                                     |
| `owner.email`          | no       | Owner contact email                                                                                                                                        |
| `plugins`              | yes      | Array of plugin entries (see below)                                                                                                                        |
| `metadata.description` | no       | Short description of the marketplace                                                                                                                       |
| `metadata.version`     | no       | Catalog metadata version string                                                                                                                            |
| `metadata.pluginRoot`  | no       | Directory for bare-name sources and the legacy fallback for `./` sources missing from the marketplace root |
| extra top-level fields | no       | Preserved by the parser but not used by marketplace install/runtime logic                                                                                  |

### Plugin entry fields

| Field                                       | Required | Description                                                                                                                                                  |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                                      | yes      | Plugin name (same naming rules as marketplace name); case-equivalent duplicates in a catalog are skipped                                                     |
| `source`                                    | yes      | Where to find the plugin — string or object (see source types below)                                                                                         |
| `description`                               | no       | Short plugin description                                                                                                                                     |
| `version`                                   | no       | Version string; falls back to `.claude-plugin/plugin.json`, root `plugin.json`, `package.json`, the source's explicit SHA (first 7 characters), then `0.0.0` |
| `author`                                    | no       | `{ name, email? }`                                                                                                                                           |
| `homepage`                                  | no       | URL                                                                                                                                                          |
| `category`                                  | no       | e.g. `development`, `productivity`, `security`                                                                                                               |
| `tags` / `keywords`                         | no       | Arrays of string tags/keywords                                                                                                                               |
| `repository`                                | no       | Repository URL                                                                                                                                               |
| `license`                                   | no       | License string                                                                                                                                               |
| `strict`                                    | no       | Boolean metadata flag; preserved but not used by install/runtime logic                                                                                       |
| `commands`, `agents`, `hooks`, `mcpServers` | no       | Catalog metadata preserved by the parser; runtime discovery comes from the installed plugin tree and manifests                                               |
| `skills`                                    | no       | Extra catalog field used for skill-path selection when the plugin source is exactly `"./"`; otherwise runtime skill discovery uses the plugin tree/manifests |
| `lspServers`                                | no       | Inline server map or path inside the plugin; installation writes `.lsp.json`                                                                                 |
| `dapAdapters`                               | no       | Inline adapter map or JSON/YAML path inside the plugin; installation writes `.dap.json`, `.dap.yaml`, or `.dap.yml`                                          |

### Full catalog example

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "acme-plugins",
  "owner": {
    "name": "Acme Corp",
    "email": "plugins@acme.example"
  },
  "metadata": {
    "description": "Official Acme plugins for tau"
  },
  "plugins": [
    {
      "name": "acme-linter",
      "description": "Enforce Acme coding standards",
      "category": "development",
      "source": "./plugins/linter"
    },
    {
      "name": "acme-deploy",
      "description": "One-command deploy to Acme cloud",
      "category": "devops",
      "source": {
        "source": "github",
        "repo": "acme-corp/tau-deploy-plugin",
        "ref": "main"
      }
    }
  ]
