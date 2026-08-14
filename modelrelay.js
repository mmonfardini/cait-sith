const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const config = require('./config');
const { buildContextPrompt } = require('./sessions');

async function queryRag(question) {
  if (!config.get('rag.enabled', false)) return '';
  try {
    const scriptPath = path.join(__dirname, 'rag', 'query.py');
    const { stdout } = await execFileAsync('python3', [scriptPath, question], {
      timeout: 15000,
      maxBuffer: 1024 * 50,
    });
    const data = JSON.parse(stdout);
    if (data.chunks && data.chunks.length > 0) {
      const lines = data.chunks.slice(0, 3).map(c =>
        `[Doc: ${path.basename(c.source)}] ${c.text.slice(0, 800)}`
      );
      return '\nReference documents:\n' + lines.join('\n---\n') + '\n';
    }
  } catch (e) {
    console.log('[RAG] Query error:', e.message);
  }
  return '';
}

async function askLLM(message, history, policy = {}) {
  const ragContext = policy.can_use_rag ? await queryRag(message) : '';

  let contextualMessage = buildContextPrompt(history || [], message);
  if (ragContext) {
    contextualMessage = ragContext + '\n' + contextualMessage;
  }

  const endpoint = config.get('llm.endpoint');
  const model = config.get('llm.model', 'llama3');
  const maxTokens = config.get('llm.max_tokens', 2048);
  const timeoutMs = config.get('llm.timeout_ms', 15000);
  const systemPrompt = config.get('bot.system_prompt', 'You are a helpful assistant.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contextualMessage },
        ],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (resp.ok) {
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (content && content.trim()) {
        return content.trim().replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      }
      console.log('[LLM] Empty response from', model);
    } else {
      const err = await resp.text();
      console.log('[LLM]', model, resp.status, err.slice(0, 200));
    }
  } catch (e) {
    console.log('[LLM] Error:', e.message);
  } finally {
    clearTimeout(timeout);
  }

  return config.get('llm.fallback_message', 'Something went wrong. Please try again.');
}

module.exports = { queryRag, askLLM };
