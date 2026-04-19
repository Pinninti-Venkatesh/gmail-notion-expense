import { google } from 'googleapis';
import { getAuthedClient } from '../auth/gmail-auth.js';
import { readJSON, writeJSON } from '../utils/state-manager.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

function getGmail() {
  const auth = getAuthedClient();
  if (!auth) throw new Error('Gmail not authenticated. Visit /api/auth first.');
  return google.gmail({ version: 'v1', auth });
}

// --- Dynamic known senders ---

function loadKnownSenders() {
  return readJSON(config.paths.knownSenders);
}

export function addKnownSender(email) {
  const senders = loadKnownSenders();
  const lower = email.toLowerCase();
  if (!senders.includes(lower)) {
    senders.push(lower);
    writeJSON(config.paths.knownSenders, senders);
    logger.info(`Added new known sender: ${lower}`);
  }
}

export function getKnownSenders() {
  return loadKnownSenders();
}

// --- Email fetching ---

function buildTransactionQuery(afterTimestamp) {
  const afterEpoch = Math.floor(afterTimestamp / 1000);
  const knownSenders = loadKnownSenders();

  // Build query: known senders OR broad keyword search for new senders
  const parts = [];

  if (knownSenders.length > 0) {
    const senderQuery = knownSenders.map((s) => `from:${s}`).join(' OR ');
    parts.push(`(${senderQuery})`);
  }

  // Broad keyword search to discover new transaction senders
  const keywordQuery = '(subject:(transaction alert OR credit card OR debit card OR spent OR debited OR payment of INR OR payment of Rs))';
  parts.push(keywordQuery);

  const fullQuery = `(${parts.join(' OR ')}) after:${afterEpoch}`;
  return fullQuery;
}

export async function fetchTransactionEmails(afterTimestamp) {
  const gmail = getGmail();
  const query = buildTransactionQuery(afterTimestamp);

  logger.debug('Gmail query', query);

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  return res.data.messages || [];
}

// --- Correlated merchant email search ---

function loadMerchantDomains() {
  return readJSON(config.paths.merchantDomains);
}

export function addMerchantDomain(merchantKeyword, domain) {
  const domains = loadMerchantDomains();
  const key = merchantKeyword.toLowerCase();
  if (!domains[key] || !domains[key].includes(domain)) {
    domains[key] = domains[key] || [];
    domains[key].push(domain);
    writeJSON(config.paths.merchantDomains, domains);
    logger.info(`Added merchant domain: ${key} → ${domain}`);
  }
}

export async function findMerchantEmail(merchantName, transactionDate) {
  const gmail = getGmail();
  const domains = loadMerchantDomains();
  const merchantLower = merchantName.toLowerCase();

  // Find matching domain(s) for this merchant
  let matchingDomains = [];
  for (const [keyword, domainList] of Object.entries(domains)) {
    if (merchantLower.includes(keyword)) {
      matchingDomains.push(...domainList);
    }
  }

  if (matchingDomains.length === 0) {
    logger.debug(`No known domain for merchant: ${merchantName}`);
    return null;
  }

  // Search for emails from merchant within ±2 hours of transaction
  const txDate = new Date(transactionDate + 'T00:00:00');
  const afterEpoch = Math.floor((txDate.getTime() - 2 * 60 * 60 * 1000) / 1000);
  const beforeEpoch = Math.floor((txDate.getTime() + 26 * 60 * 60 * 1000) / 1000);

  const fromQuery = matchingDomains.map((d) => `from:${d}`).join(' OR ');
  const query = `(${fromQuery}) after:${afterEpoch} before:${beforeEpoch}`;

  logger.debug(`Merchant email search: ${query}`);

  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 3,
    });

    if (!res.data.messages || res.data.messages.length === 0) return null;

    // Return the most recent matching email
    const email = await getEmailDetails(res.data.messages[0].id);
    return email;
  } catch (err) {
    logger.warn(`Merchant email search failed for ${merchantName}`, err.message);
    return null;
  }
}

// --- Email detail extraction ---

export async function getEmailDetails(messageId) {
  const gmail = getGmail();
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return res.data;
}

export function extractSenderEmail(message) {
  const fromHeader = message.payload.headers.find(
    (h) => h.name.toLowerCase() === 'from'
  );
  if (!fromHeader) return '';
  const match = fromHeader.value.match(/<(.+?)>/);
  return match ? match[1].toLowerCase() : fromHeader.value.toLowerCase();
}

export function extractSubject(message) {
  const subjectHeader = message.payload.headers.find(
    (h) => h.name.toLowerCase() === 'subject'
  );
  return subjectHeader ? subjectHeader.value : '';
}

export function extractEmailBody(message) {
  const { payload } = message;

  // Simple single-part message
  if (payload.body && payload.body.data) {
    return decodeBase64(payload.body.data);
  }

  // Multipart — prefer text/plain, fallback to text/html
  if (payload.parts) {
    const textPart = findPart(payload.parts, 'text/plain');
    if (textPart && textPart.body && textPart.body.data) {
      return decodeBase64(textPart.body.data);
    }

    const htmlPart = findPart(payload.parts, 'text/html');
    if (htmlPart && htmlPart.body && htmlPart.body.data) {
      return stripHtml(decodeBase64(htmlPart.body.data));
    }
  }

  return '';
}

function findPart(parts, mimeType) {
  for (const part of parts) {
    if (part.mimeType === mimeType) return part;
    if (part.parts) {
      const found = findPart(part.parts, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function decodeBase64(data) {
  return Buffer.from(data, 'base64').toString('utf-8');
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
