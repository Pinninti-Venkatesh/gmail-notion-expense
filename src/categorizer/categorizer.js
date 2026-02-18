import config from '../config/index.js';
import { readJSON, writeJSON } from '../utils/state-manager.js';
import logger from '../utils/logger.js';

let categoryMap = null;

function loadMap() {
  if (!categoryMap) {
    categoryMap = readJSON(config.paths.categoryMap);
  }
  return categoryMap;
}

export function categorize(merchant) {
  const map = loadMap();
  const lower = merchant.toLowerCase();

  // Exact match
  if (map[lower]) return map[lower];

  // Substring keyword match
  for (const [keyword, category] of Object.entries(map)) {
    if (lower.includes(keyword)) return category;
  }

  return 'General';
}

export function updateCategoryMap(newMappings) {
  const map = loadMap();
  let updated = 0;

  for (const [merchant, category] of Object.entries(newMappings)) {
    const key = merchant.toLowerCase();
    if (map[key] !== category) {
      map[key] = category;
      updated++;
    }
  }

  if (updated > 0) {
    writeJSON(config.paths.categoryMap, map);
    logger.info(`Category map updated with ${updated} new mappings`);
  }

  return updated;
}

export function getCategoryMap() {
  return { ...loadMap() };
}

export function reloadCategoryMap() {
  categoryMap = null;
  loadMap();
}
