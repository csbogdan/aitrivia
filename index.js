import 'dotenv/config';
import config from 'config';
import IRC from 'irc-framework';
import { watch } from 'fs';
import { resolve } from 'path';
import { initDb } from './src/db.js';
import { initQueue } from './src/sendQueue.js';

// Stateful modules — initialized once, never reloaded
initDb(config.get('database.path'));

const client = new IRC.Client();
initQueue(client);

// Hot-reloadable handler — single file, cache-bust the whole thing
let h = await import('./src/handler.js');

const srcDir = resolve('./src');
let debounce = null;
watch(srcDir, { recursive: true }, (_, filename) => {
  if (!filename?.endsWith('.js')) return;
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    try {
      h = await import(`./src/handler.js?t=${Date.now()}`);
      console.log(`[reload] ${filename} — handler reloaded`);
    } catch (err) {
      console.error(`[reload] FAILED: ${err.message}`);
    }
  }, 150);
});

// IRC
const irc = config.get('irc');
const loc = irc.loc || {};

client.connect({
  host: irc.host,
  port: irc.port,
  nick: irc.nick,
  username: irc.username,
  gecos: irc.realname,
  password: loc.enabled ? `${loc.username}:${process.env.IRC_LOC_PASSWORD || loc.password}` : undefined,
  reconnect: true,
  reconnect_max_wait: 30000,
});

client.on('registered', () => {
  console.log(`[irc] connected to ${irc.host} as ${irc.nick}`);
  for (const ch of config.get('bot.default_channels') || []) client.join(ch);
});

client.on('message', async (event) => {
  if (event.type !== 'privmsg') return;
  if (event.target === client.user.nick) {
    h.handleOwnerPrivmsg(client, event.nick, event.hostname, event.message);
  } else {
    await h.handleMessage(client, event.target, event.nick, event.hostname, event.message);
  }
});

client.on('socket close', () => {
  console.log('[irc] disconnected — resetting game state');
  h.resetAll();
});

client.on('reconnecting', ({ attempt, max_wait }) => {
  console.log(`[irc] reconnecting (attempt ${attempt}, wait ${max_wait}ms)`);
});
