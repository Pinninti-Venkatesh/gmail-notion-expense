import { Router } from 'express';
import { getAuthUrl, handleAuthCallback, isAuthenticated } from '../auth/gmail-auth.js';
import { processEmails } from '../scheduler/cron-job.js';
import { fetchCategorizedEntries } from '../notion/notion-client.js';
import { updateCategoryMap, getCategoryMap, reloadCategoryMap } from '../categorizer/categorizer.js';
import { getKnownSenders, addKnownSender, addMerchantDomain } from '../gmail/gmail-client.js';
import { isOllamaAvailable } from '../llm/ollama-client.js';
import logger from '../utils/logger.js';
import { readJSON } from '../utils/state-manager.js';
import config from '../config/index.js';

const router = Router();

// Health check
router.get('/health', async (_req, res) => {
  const ollamaReady = await isOllamaAvailable();
  res.json({
    status: 'ok',
    authenticated: isAuthenticated(),
    ollamaAvailable: ollamaReady,
    timestamp: new Date().toISOString(),
  });
});

// Start Gmail OAuth flow
router.get('/auth', (_req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// OAuth callback
router.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    await handleAuthCallback(code);
    res.json({ message: 'Gmail authenticated successfully. Polling will start on the next cron cycle.' });
  } catch (err) {
    logger.error('OAuth callback failed', err.message);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// Manually trigger email poll
router.post('/sync', async (_req, res) => {
  if (!isAuthenticated()) {
    return res.status(401).json({ error: 'Gmail not authenticated. Visit /api/auth first.' });
  }

  try {
    const results = await processEmails();
    const hasInvalidGrant = results.errors?.some(e => e.error === 'invalid_grant');
    if (hasInvalidGrant) {
      return res.status(401).json({ error: 'Gmail token expired. Re-authenticate at /api/auth.', results });
    }
    res.json({ message: 'Sync complete', results });
  } catch (err) {
    logger.error('Manual sync failed', err.message);
    res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

// Learn categories from Notion
router.post('/sync-categories', async (_req, res) => {
  try {
    const entries = await fetchCategorizedEntries();

    const mappings = {};
    for (const { merchant, category } of entries) {
      mappings[merchant] = category;
    }

    const updated = updateCategoryMap(mappings);
    reloadCategoryMap();

    res.json({
      message: `Category sync complete. ${updated} mapping(s) updated.`,
      totalEntries: entries.length,
    });
  } catch (err) {
    logger.error('Category sync failed', err.message);
    res.status(500).json({ error: 'Category sync failed', details: err.message });
  }
});

// View current category map
router.get('/categories', (_req, res) => {
  res.json(getCategoryMap());
});

// View known transaction senders (auto-learned + seeded)
router.get('/known-senders', (_req, res) => {
  res.json(getKnownSenders());
});

// Manually add a known sender
router.post('/known-senders', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Missing "email" in request body' });
  }
  addKnownSender(email);
  res.json({ message: `Added known sender: ${email}`, senders: getKnownSenders() });
});

// View merchant domain mappings
router.get('/merchant-domains', (_req, res) => {
  res.json(readJSON(config.paths.merchantDomains));
});

// Add a merchant domain mapping
router.post('/merchant-domains', (req, res) => {
  const { merchant, domain } = req.body;
  if (!merchant || !domain) {
    return res.status(400).json({ error: 'Missing "merchant" and/or "domain" in request body' });
  }
  addMerchantDomain(merchant, domain);
  res.json({ message: `Added domain mapping: ${merchant} → ${domain}` });
});

export default router;
