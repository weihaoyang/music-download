'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[process.env.MF_LOG_LEVEL] ?? LEVELS.info;

function make(level) {
  return (...args) => {
    if (LEVELS[level] <= current) {
      // eslint-disable-next-line no-console
      console.log(`[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)}`, ...args);
    }
  };
}

module.exports = {
  error: make('error'),
  warn: make('warn'),
  info: make('info'),
  debug: make('debug'),
};
