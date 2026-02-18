const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function fmt(level, msg, data) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

const logger = {
  error: (msg, data) => { if (currentLevel >= LEVELS.error) console.error(fmt('error', msg, data)); },
  warn:  (msg, data) => { if (currentLevel >= LEVELS.warn)  console.warn(fmt('warn', msg, data)); },
  info:  (msg, data) => { if (currentLevel >= LEVELS.info)  console.log(fmt('info', msg, data)); },
  debug: (msg, data) => { if (currentLevel >= LEVELS.debug) console.log(fmt('debug', msg, data)); },
};

export default logger;
