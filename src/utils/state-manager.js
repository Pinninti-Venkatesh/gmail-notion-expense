import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const DEFAULTS_DIR = 'data/defaults';

// Runtime state files are gitignored so a user's learned senders and merchants
// never land in the repo. On first read we seed them from the tracked defaults.
function readDefaults(filePath) {
  const seedPath = path.join(DEFAULTS_DIR, path.basename(filePath));
  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  } catch {
    return filePath.endsWith('category-map.json') ? {} : [];
  }
}

export function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const seeded = readDefaults(filePath);
      logger.warn(`File not found, seeding from defaults: ${filePath}`);
      writeJSON(filePath, seeded);
      return seeded;
    }
    logger.error(`Failed to read ${filePath}`, err.message);
    throw err;
  }
}

export function writeJSON(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Failed to write ${filePath}`, err.message);
    throw err;
  }
}
