// Rate-limited IRC send queue — prevents flood disconnect on Undernet
// Undernet ircu treats ~5+ rapid lines as a flood; we stay well under that.
const INTERVAL_MS = 600;  // one message per 600ms = ~100/min, safe for ircu

let client;
const queue = [];
let timer = null;

export function initQueue(ircClient) {
  client = ircClient;
}

export function say(target, text) {
  // Split long messages at 400 chars to avoid IRC line length limits
  const chunks = text.match(/.{1,400}/g) || [''];
  for (const chunk of chunks) {
    queue.push({ target, text: chunk });
  }
  if (!timer) {
    timer = setInterval(flush, INTERVAL_MS);
  }
}

export function clearQueue() {
  queue.length = 0;
}

function flush() {
  if (!queue.length) {
    clearInterval(timer);
    timer = null;
    return;
  }
  const { target, text } = queue.shift();
  client.say(target, text);
}
