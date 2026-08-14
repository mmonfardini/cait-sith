const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
const MAX_HISTORY = 20;
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function cleanupStaleSessions() {
  const now = Date.now();
  let cleaned = 0;
  try {
    for (const file of fs.readdirSync(SESSIONS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const fp = path.join(SESSIONS_DIR, file);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > CLEANUP_AGE_MS) {
        fs.unlinkSync(fp);
        cleaned++;
      }
    }
  } catch (e) { /* empty */ }
  if (cleaned) console.log(`[SESSION] Limpos ${cleaned} sessoes inativas (>24h)`);
}

function safeThreadId(raw) {
  if (!raw) return null;
  return raw.replace(/[^a-zA-Z0-9_\/-]/g, '_').replace(/\//g, '__');
}

function loadHistory(threadId) {
  const fp = path.join(SESSIONS_DIR, `${threadId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(data?.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

function saveHistory(threadId, messages) {
  const fp = path.join(SESSIONS_DIR, `${threadId}.json`);
  const trimmed = messages.slice(-MAX_HISTORY);
  fs.writeFileSync(fp, JSON.stringify({ threadId, messages: trimmed, updated: Date.now() }));
}

function buildContextPrompt(history, newMessage) {
  if (!history.length) return newMessage;
  const lines = history.map(m =>
    `${m.role === 'user' ? 'Usuario' : 'BIA'}: ${m.content}`
  ).join('\n');
  return `Historico da conversa:\n${lines}\n\nUsuario: ${newMessage}\nBIA:`;
}

module.exports = {
  cleanupStaleSessions,
  safeThreadId,
  loadHistory,
  saveHistory,
  buildContextPrompt,
};
