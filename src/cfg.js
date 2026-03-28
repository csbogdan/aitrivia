import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { resolve } from 'path';

const FILE = resolve('./config/default.yaml');

let _cache = null;
let _cacheAt = 0;
const TTL = 2000; // re-read file at most every 2 seconds

export function cfg() {
  const now = Date.now();
  if (!_cache || now - _cacheAt > TTL) {
    _cache = parse(readFileSync(FILE, 'utf8'));
    _cacheAt = now;
  }
  return _cache;
}

// Force an immediate re-read on next call
export function invalidate() {
  _cacheAt = 0;
}
