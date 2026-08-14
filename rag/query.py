#!/usr/bin/env python3
"""
Semantic search against Supabase pgvector using Ollama embeddings.
Usage: python3 rag/query.py "your question here"
"""
import os, sys, json, yaml
from pathlib import Path

config_path = Path(__file__).parent.parent / "config.yaml"
if config_path.exists():
    cfg = yaml.safe_load(config_path.read_text())
else:
    cfg = {}

env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

SUPABASE_URL = os.environ.get("SUPABASE_URL", cfg.get("supabase", {}).get("url", ""))
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", cfg.get("supabase", {}).get("service_key", ""))
OLLAMA_URL = cfg.get("rag", {}).get("ollama_url", "http://localhost:11434")
EMBED_MODEL = cfg.get("rag", {}).get("embedding_model", "nomic-embed-text")
N_RESULTS = cfg.get("rag", {}).get("top_k", 5)


def search(question):
    if not all([SUPABASE_URL, SUPABASE_KEY]):
        return []

    import httpx

    emb_resp = httpx.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": [question]},
        timeout=15,
    )
    emb_resp.raise_for_status()
    embedding = emb_resp.json()["embeddings"][0]

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    r = httpx.post(
        f"{SUPABASE_URL}/rest/v1/rpc/search_chunks",
        json={"query_embedding": embedding, "max_results": N_RESULTS},
        headers=headers,
        timeout=15,
    )
    if r.status_code != 200:
        return []

    return [
        {
            "text": row.get("content", ""),
            "source": row.get("source", ""),
            "score": round(float(row.get("similarity", 0)), 4),
        }
        for row in r.json()
    ]


def main():
    question = " ".join(sys.argv[1:]).strip() if sys.argv[1:] else sys.stdin.read().strip()
    if not question:
        print(json.dumps({"chunks": []}))
        return
    print(json.dumps({"chunks": search(question)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
