import { google } from 'googleapis';
import fs from 'fs';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const { clientId, clientSecret, redirectUri, scopes, tokenPath } = config.gmail;

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

export function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  });
}

export async function handleAuthCallback(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');
  logger.info('Gmail tokens saved');
  return tokens;
}

export function getAuthedClient() {
  if (oauth2Client.credentials && oauth2Client.credentials.access_token) {
    return oauth2Client;
  }
  try {
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    oauth2Client.setCredentials(tokens);
    return oauth2Client;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return getAuthedClient() !== null;
}
