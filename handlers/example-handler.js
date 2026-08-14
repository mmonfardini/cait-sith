// Example handler - responds to "ping" with "pong".
// Create your own by exporting match() and handle().
// Drop .js files here and they load automatically.

function match(message) {
  return /^ping$/i.test(message.trim());
}

async function handle() {
  return 'pong';
}

module.exports = { match, handle };
