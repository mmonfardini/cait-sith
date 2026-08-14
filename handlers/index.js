const fs = require('fs');
const path = require('path');
const config = require('../config');

let _handlers = null;

function loadHandlers() {
  if (_handlers) return _handlers;
  _handlers = [];

  if (!config.get('handlers.enabled', false)) return _handlers;

  const dir = path.resolve(__dirname);
  for (const file of fs.readdirSync(dir)) {
    if (file === 'index.js' || !file.endsWith('.js')) continue;
    try {
      const handler = require(path.join(dir, file));
      if (typeof handler.match === 'function' && typeof handler.handle === 'function') {
        _handlers.push({ name: file.replace('.js', ''), ...handler });
        console.log(`[HANDLER] Loaded: ${file}`);
      }
    } catch (e) {
      console.log(`[HANDLER] Failed to load ${file}:`, e.message);
    }
  }
  return _handlers;
}

async function tryHandlers(message, history, policy) {
  for (const handler of loadHandlers()) {
    if (handler.match(message, policy)) {
      try {
        const result = await handler.handle(message, history, policy);
        if (result) return result;
      } catch (e) {
        console.log(`[HANDLER:${handler.name}] Error:`, e.message);
      }
    }
  }
  return null;
}

module.exports = { tryHandlers };
