#!/usr/bin/env python3
import sys
import json
import os
from typing import Any, List, Dict

def main():
    target = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None

    # In non-interactive streaming / piped mode, pass raw stream directly
    if not sys.stdout.isatty():
        if target and os.path.exists(target):
            with open(target, "r", errors="replace") as f:
                for line in f:
                    sys.stdout.write(line)
        else:
            for line in sys.stdin:
                sys.stdout.write(line)
        return

    # In TTY mode, protectively parse and render compact table
    try:
        if target and os.path.exists(target):
            with open(target, "r", errors="replace") as f:
                raw_text = f.read()
        else:
            raw_text = sys.stdin.read()
    except Exception:
        return

    if not raw_text.strip():
        return

    try:
        data: Any = json.loads(raw_text)
    except Exception:
        # Graceful fallback: render truncated preview without crashing
        preview = raw_text[:800]
        sys.stdout.write(preview + ("\n... [TRUNCATED RAW TEXT]\n" if len(raw_text) > 800 else "\n"))
        return

    models: List[Dict[str, Any]] = []

    def extract_models(node: Any):
        if isinstance(node, list):
            for item in node:
                extract_models(item)
        elif isinstance(node, dict):
            if "id" in node or "model" in node:
                models.append(node)
            elif "data" in node and isinstance(node["data"], list):
                extract_models(node["data"])
            elif "models" in node and isinstance(node["models"], (list, dict)):
                extract_models(node["models"])
            else:
                for v in node.values():
                    if isinstance(v, (dict, list)):
                        extract_models(v)

    extract_models(data)

    if not models:
        sys.stdout.write("No models found in payload.\n")
        return

    hdr = f"{'MODEL ID':<35} {'PROVIDER':<12} {'CONTEXT':<10} {'MAX OUT':<10} {'REASONING':<10} {'DIALECT':<12} {'IN/OUT COST'}"
    divider = "=" * len(hdr)
    sys.stdout.write(divider + "\n" + hdr + "\n" + divider + "\n")

    for m in sorted(models, key=lambda x: str(x.get("id") or x.get("model") or "")):
        m_id = str(m.get("id") or m.get("model") or "unknown")[:34]
        provider = str(m.get("provider") or m.get("owned_by") or "-")[:11]
        ctx = str(m.get("contextWindow") or m.get("context_window") or "-")[:9]
        max_t = str(m.get("maxTokens") or m.get("max_tokens") or "-")[:9]
        reasoning = "YES" if m.get("reasoning") or m.get("thinking") else "NO"

        compat = m.get("compat") if isinstance(m.get("compat"), dict) else {}
        dialect = str(compat.get("thinkingFormat") or compat.get("format") or "-")[:11]

        cost = m.get("cost") if isinstance(m.get("cost"), dict) else {}
        if not cost and isinstance(m.get("pricing"), dict):
            cost = m.get("pricing")

        cost_str = f"${cost.get('input', 0)} / ${cost.get('output', 0)}" if cost else "-"
        sys.stdout.write(f"{m_id:<35} {provider:<12} {ctx:<10} {max_t:<10} {reasoning:<10} {dialect:<12} {cost_str}\n")

    sys.stdout.write(divider + "\n")
    sys.stdout.write(f"Total Models Cataloged: {len(models)}\n")

if __name__ == "__main__":
    main()
