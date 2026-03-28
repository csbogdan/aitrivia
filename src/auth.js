import config from 'config';

const owners = config.get('bot.owners');

// Match an IRC hostmask pattern (supports * and ? wildcards) against a string
function matchMask(pattern, value) {
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i'
  );
  return regex.test(value);
}

// Returns true if the given nick+host combination matches any configured owner entry
export function isOwner(nick, host) {
  return owners.some(owner =>
    owner.nick.toLowerCase() === nick.toLowerCase() &&
    matchMask(owner.hostmask, host)
  );
}
