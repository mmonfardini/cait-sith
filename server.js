const express = require('express');
const app = express();
const config = require('./config');

const { cleanupStaleSessions, safeThreadId, loadHistory, saveHistory } = require('./sessions');
cleanupStaleSessions();

app.use(express.json());

const { chatResponse } = require('./chat-response');
const { askLLM } = require('./modelrelay');
const { getAccessPolicy, blockedMessageFor, userEmailFrom } = require('./access-policy');
const { tryHandlers } = require('./handlers');

async function handleMessage({ msg, user, spaceId, userEmail }) {
  const threadId = safeThreadId(spaceId);
  const history = threadId ? loadHistory(threadId) : [];
  const policy = getAccessPolicy(spaceId, userEmail);

  if (!msg) return chatResponse('Hey! How can I help?');

  const blocked = blockedMessageFor(msg, policy);
  if (blocked) return chatResponse(blocked);

  try {
    const handled = await tryHandlers(msg, history, policy);
    if (handled) {
      if (threadId) {
        history.push({ role: 'user', content: msg, ts: Date.now() });
        history.push({ role: 'assistant', content: handled, ts: Date.now() });
        saveHistory(threadId, history);
      }
      return chatResponse(handled);
    }

    const response = await askLLM(msg, history, policy);

    if (threadId) {
      history.push({ role: 'user', content: msg, ts: Date.now() });
      history.push({ role: 'assistant', content: response, ts: Date.now() });
      saveHistory(threadId, history);
    }

    return chatResponse(response);
  } catch (e) {
    console.log('[ERROR] handleMessage:', e.message);
    return chatResponse(config.get('llm.fallback_message', 'Something went wrong. Please try again.'));
  }
}

const routes = ['/', config.get('bot.route', '/chat')];
routes.forEach(route => {
  app.get(route, (_req, res) => res.json({ status: 'ok', bot: config.get('bot.name', 'Bot') }));

  app.post(route, async (req, res) => {
    const body = req.body;

    if (body.challenge) return res.json({ challenge: body.challenge });

    // Add-on format (2024+)
    const isNewFormat = body.commonEventObject && body.chat?.messagePayload?.message;
    if (isNewFormat) {
      const payload = body.chat.messagePayload;
      const message = payload.message;
      return res.json(await handleMessage({
        msg: (message.argumentText || message.text || '').trim(),
        user: payload.user?.displayName || 'User',
        spaceId: message.space?.name || body.chat?.space?.name || message.thread?.name || '',
        userEmail: userEmailFrom(payload.user, body.user, message.sender),
      }));
    }

    if (body.type === 'ADDED_TO_SPACE' || body.chat?.addedToSpacePayload) {
      return res.json(chatResponse(config.get('bot.welcome_message', 'Hello!')));
    }

    // Legacy format
    if (body.type === 'MESSAGE' || body.message) {
      return res.json(await handleMessage({
        msg: (body.message?.argumentText || body.message?.text || '').trim(),
        user: body.user?.displayName || 'User',
        spaceId: body.space?.name || body.message?.space?.name || body.message?.thread?.name || '',
        userEmail: userEmailFrom(body.user, body.message?.sender),
      }));
    }

    if (body.type === 'REMOVED_FROM_SPACE') return res.status(200).end();

    res.json(chatResponse('Received!'));
  });
});

const PORT = config.get('bot.port', 3005);
app.listen(PORT, () => {
  console.log(`${config.get('bot.name', 'Bot')} running on port ${PORT}`);
});
