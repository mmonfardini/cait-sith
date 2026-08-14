#!/usr/bin/env python3
"""
RAG Indexer - scans Google Drive, extracts text, chunks it, generates
embeddings via Ollama, and upserts into Supabase pgvector.

Idempotent: only reprocesses new or modified files.

Usage:
  python3 rag/indexer.py                    # index changed files
  python3 rag/indexer.py --dry-run          # show what would be indexed
  python3 rag/indexer.py --force            # reindex everything
"""
import os, sys, yaml
from pathlib import Path
from collections import deque

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
CHUNK_SIZE = cfg.get("rag", {}).get("chunk_size", 800)
CHUNK_OVERLAP = cfg.get("rag", {}).get("chunk_overlap", 150)
FOLDERS = cfg.get("rag", {}).get("drive_folders", [])
SA_PATH = cfg.get("rag", {}).get("service_account_path", "")

EXTRACTABLE_MIMES = {
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.presentation",
    "application/pdf",
    "text/markdown",
    "text/plain",
}

# -- Drive --

def build_drive_service():
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    creds = Credentials.from_service_account_file(
        SA_PATH, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)

def scan_folder(service, folder_id):
    files = []
    queue = deque([folder_id])
    while queue:
        parent = queue.popleft()
        page_token = None
        while True:
            resp = service.files().list(
                q=f"'{parent}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType, modifiedTime, size)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                pageSize=200,
                pageToken=page_token,
            ).execute()
            for f in resp.get("files", []):
                if f["mimeType"] == "application/vnd.google-apps.folder":
                    queue.append(f["id"])
                elif f["mimeType"] in EXTRACTABLE_MIMES:
                    files.append(f)
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    return files

# -- Text extraction --

def extract_text(service, file_meta):
    mime = file_meta["mimeType"]
    file_id = file_meta["id"]

    if mime in ("application/vnd.google-apps.document", "application/vnd.google-apps.presentation"):
        content = service.files().export(fileId=file_id, mimeType="text/plain").execute()
        return content.decode("utf-8") if isinstance(content, bytes) else content

    if mime == "application/pdf":
        import io
        content = service.files().get_media(fileId=file_id).execute()
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as e:
            print(f"  [WARN] PDF extraction failed for {file_meta['name']}: {e}")
            return ""

    if mime in ("text/markdown", "text/plain"):
        content = service.files().get_media(fileId=file_id).execute()
        return content.decode("utf-8") if isinstance(content, bytes) else content

    return ""

# -- Chunking --

def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start = end - overlap
    return chunks

# -- Embeddings --

def generate_embeddings(texts, batch_size=20):
    import httpx
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        r = httpx.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": batch},
            timeout=60,
        )
        r.raise_for_status()
        all_embeddings.extend(r.json()["embeddings"])
    return all_embeddings

# -- Supabase --

def supabase_request(method, path, data=None):
    import httpx
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    r = getattr(httpx, method.lower())(url, json=data, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json() if r.text else []

def get_indexed_files():
    rows = supabase_request("GET", "files?select=id,drive_id,modified_at&limit=5000")
    return {
        r["drive_id"]: {"file_id": r["id"], "modified_at": r["modified_at"]}
        for r in rows
    }

def upsert_file(file_meta):
    drive_id = file_meta["id"]
    existing = supabase_request("GET", f"files?drive_id=eq.{drive_id}&select=id&limit=1")
    if existing:
        file_id = existing[0]["id"]
        supabase_request("PATCH", f"files?id=eq.{file_id}", {
            "modified_at": file_meta["modifiedTime"],
            "name": file_meta["name"],
        })
        return file_id
    ext = file_meta["name"].rsplit(".", 1)[-1] if "." in file_meta["name"] else ""
    result = supabase_request("POST", "files", {
        "drive_id": drive_id,
        "name": file_meta["name"],
        "mime_type": file_meta["mimeType"],
        "extension": ext,
        "modified_at": file_meta["modifiedTime"],
        "extracted": True,
    })
    return result[0]["id"]

def delete_chunks(file_id):
    supabase_request("DELETE", f"chunks?file_id=eq.{file_id}")

def insert_chunks(file_id, source, chunks, embeddings):
    rows = [
        {"file_id": file_id, "content": text, "source": source, "chunk_index": i, "embedding": emb}
        for i, (text, emb) in enumerate(zip(chunks, embeddings))
    ]
    for i in range(0, len(rows), 50):
        supabase_request("POST", "chunks", rows[i:i + 50])

# -- Main --

def main():
    dry_run = "--dry-run" in sys.argv
    force = "--force" in sys.argv

    if not all([SUPABASE_URL, SUPABASE_KEY, SA_PATH]):
        print("[ERROR] Missing config: supabase url/key or service_account_path")
        sys.exit(1)

    if not FOLDERS:
        print("[ERROR] No drive_folders configured in config.yaml")
        sys.exit(1)

    print(f"[INDEXER] Starting {'(DRY-RUN)' if dry_run else ''}...")
    service = build_drive_service()

    print(f"[SCAN] Scanning {len(FOLDERS)} folders...")
    files = []
    for folder_id in FOLDERS:
        files.extend(scan_folder(service, folder_id))
    seen = {}
    for f in files:
        seen[f["id"]] = f
    files = list(seen.values())
    print(f"[SCAN] {len(files)} extractable files found.")

    indexed = get_indexed_files()
    to_process = []
    for f in files:
        existing = indexed.get(f["id"])
        if existing and not force:
            if existing["modified_at"] and f["modifiedTime"] <= existing["modified_at"]:
                continue
        to_process.append(f)

    if not to_process:
        print("[INDEXER] Nothing to index.")
        return

    print(f"[INDEXER] {len(to_process)} file(s) to process:")
    for f in to_process:
        status = "NEW" if f["id"] not in indexed else "MODIFIED"
        print(f"  [{status}] {f['name']}")

    if dry_run:
        print("[DRY-RUN] No changes made.")
        return

    total_chunks = 0
    errors = 0
    for i, f in enumerate(to_process, 1):
        try:
            print(f"\n[{i}/{len(to_process)}] {f['name']}")
            print("  Extracting text...")
            text = extract_text(service, f)
            if not text or len(text.strip()) < 50:
                print(f"  [SKIP] Too short ({len(text.strip())} chars)")
                continue

            print(f"  Text: {len(text)} chars")
            chunks = chunk_text(text)
            print(f"  Chunks: {len(chunks)}")
            print("  Generating embeddings...")
            embeddings = generate_embeddings(chunks)
            print("  Saving to Supabase...")
            file_id = upsert_file(f)
            delete_chunks(file_id)
            insert_chunks(file_id, f["name"], chunks, embeddings)
            total_chunks += len(chunks)
            print(f"  OK ({len(chunks)} chunks)")
        except Exception as e:
            errors += 1
            print(f"  [ERROR] {e}")

    print(f"\n[INDEXER] Done. {len(to_process)} file(s), {total_chunks} chunks indexed, {errors} errors.")


if __name__ == "__main__":
    main()
