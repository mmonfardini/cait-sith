# cait-sith

Self-hosted AI assistant for Google Chat. Bring your own LLM, optional RAG over Google Drive.

Named after the fortune-telling cat from Final Fantasy VII.

## Features

- **Google Chat integration** - handles the undocumented Add-on response format (`hostAppDataAction`)
- **Any LLM backend** - Ollama, vLLM, LiteLLM, OpenAI, or any OpenAI-compatible API
- **Optional RAG** - index Google Drive folders into Supabase pgvector with local embeddings (zero API cost)
- **Access control** - profile-based permissions per user or Chat space
- **Plugin handlers** - drop `.js` files in `handlers/` to add custom responses before the LLM
- **Session memory** - per-thread conversation history with automatic cleanup
- **Single config file** - everything in `config.yaml`

## Quick Start

```bash
git clone https://github.com/mmonfardini/cait-sith.git
cd cait-sith
npm install
cp config.example.yaml config.yaml
# edit config.yaml with your LLM endpoint, bot name, etc.
node server.js
```

### With Docker

```bash
cp config.example.yaml config.yaml
# edit config.yaml
docker compose up -d
# pull an embedding model (if using RAG)
docker compose exec ollama ollama pull nomic-embed-text
```

## Google Chat Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the **Google Chat API**
3. Configure the Chat app:
   - **App URL**: `https://your-server.com/chat` (must be HTTPS)
   - **Functionality**: receive 1:1 and space messages
4. Deploy behind a reverse proxy with HTTPS (nginx, Traefik, Cloudflare Tunnel, etc.)

> Google Chat apps use the [Workspace Add-on response format](https://developers.google.com/workspace/add-ons), not the legacy Chat API format. This bot handles that via `chat-response.js`.

## RAG Setup (Optional)

1. Create a [Supabase](https://supabase.com) project
2. Run `supabase/schema.sql` in the SQL Editor
3. Create a [Google service account](https://cloud.google.com/iam/docs/service-accounts-create) with Drive read access
4. Update `config.yaml`:

```yaml
rag:
  enabled: true
  drive_folders:
    - "your-google-drive-folder-id"
  service_account_path: "./service-account.json"

supabase:
  url: "https://your-project.supabase.co"
  service_key: "your-service-key"
```

5. Index your documents:

```bash
python3 rag/indexer.py --dry-run   # preview
python3 rag/indexer.py             # run
```

The indexer is idempotent - only reprocesses files modified since the last run.

## Custom Handlers

Drop `.js` files in `handlers/` to intercept messages before the LLM. Each handler exports `match()` and `handle()`:

```js
// handlers/my-handler.js
function match(message, policy) {
  return /^hello$/i.test(message);
}

async function handle(message, history, policy) {
  return 'Hello!';
}

module.exports = { match, handle };
```

Enable in `config.yaml`:

```yaml
handlers:
  enabled: true
```

## Architecture

```
Google Chat -> server.js -> access-policy.js -> handlers/ -> modelrelay.js -> LLM
                                                                  |
                                                             rag/query.py -> Supabase pgvector
```

- **server.js** - Express webhook, parses Google Chat events
- **chat-response.js** - wraps text in the Add-on response format
- **sessions.js** - file-based per-thread conversation history
- **access-policy.js** - profile-based access control from config
- **handlers/** - pluggable intent handlers (run before LLM)
- **modelrelay.js** - sends messages to LLM with optional RAG context
- **rag/** - Google Drive indexer + semantic search (Python)

## License

MIT
