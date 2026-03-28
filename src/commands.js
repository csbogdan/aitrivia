import config from 'config';
import { isOwner } from './auth.js';
import { say } from './sendQueue.js';
import {
  startGame, stopGame, skipQuestion, handleAnswer,
  showScores, showLeaderboard, setTopic, setDifficulty, setLanguage,
} from './game.js';

const PREFIX = config.get('bot.command_prefix') || '!';
const START_PERM = config.get('game.start_permission') || 'owner';

export async function handleMessage(channel, nick, host, text) {
  const owner = isOwner(nick, host);

  // Check for answer attempt (non-command, game active)
  if (!text.startsWith(PREFIX)) {
    await handleAnswer(channel, nick, text);
    return;
  }

  const [cmd, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'start':
      if (START_PERM === 'owner' && !owner) return;
      await startGame(channel);
      break;

    case 'stop':
      if (!owner) return;
      stopGame(channel);
      break;

    case 'skip':
      if (!owner) return;
      await skipQuestion(channel);
      break;

    case 'scores':
      showScores(channel);
      break;

    case 'leaderboard':
    case 'lb':
      showLeaderboard(channel);
      break;

    case 'topic':
      if (!owner) return;
      if (!args.length) { say(channel, 'Usage: !topic <topic>'); return; }
      setTopic(channel, args.join(' '));
      break;

    case 'difficulty':
    case 'diff':
      if (!owner) return;
      if (!args.length) { say(channel, 'Usage: !difficulty <easy|medium|hard>'); return; }
      setDifficulty(channel, args[0].toLowerCase());
      break;

    case 'language':
    case 'lang':
      if (!owner) return;
      if (!args.length) { say(channel, 'Usage: !language <English|French|Spanish|...>'); return; }
      setLanguage(channel, args.join(' '));
      break;

    case 'help':
      say(channel, `Commands: ${PREFIX}start  ${PREFIX}stop  ${PREFIX}skip  ${PREFIX}scores  ${PREFIX}leaderboard` +
        (owner ? `  [owner: ${PREFIX}topic <t>  ${PREFIX}difficulty <e/m/h>  ${PREFIX}language <lang>  ${PREFIX}join <#ch>  ${PREFIX}part <#ch>]` : ''));
      break;
  }
}

export function handleOwnerPrivmsg(client, nick, host, text) {
  if (!isOwner(nick, host)) return;
  if (!text.startsWith(PREFIX)) return;
  const [cmd, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'join':
      if (!args[0]) return;
      client.join(args[0]);
      break;
    case 'part':
      if (!args[0]) return;
      client.part(args[0]);
      break;
  }
}
