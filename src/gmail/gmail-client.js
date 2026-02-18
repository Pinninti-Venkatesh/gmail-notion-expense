import { google } from 'googleapis';
import { getAuthedClient } from '../auth/gmail-auth.js';
import logger from '../utils/logger.js';

function getGmail() {
  const auth = getAuthedClient();
  if (!auth) throw new Error('Gmail not authenticated. Visit /api/auth first.');
  return google.gmail({ version: 'v1', auth });
}

const BANK_QUERY = [
  // Replace with the alert addresses your own bank sends from
  'from:alerts@examplebank.test',
].join(' OR ');

export async function fetchNewAlertEmails(afterTimestamp) {
  const gmail = getGmail();
  const afterEpoch = Math.floor(afterTimestamp / 1000);
  const query = `(${BANK_QUERY}) after:${afterEpoch}`;

  logger.debug('Gmail query', query);

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  return res.data.messages || [];
}

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
