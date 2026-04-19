import dotenv from 'dotenv';
dotenv.config();

const config = {
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/auth/callback',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    tokenPath: 'data/gmail-token.json',
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY,
    databaseId: process.env.NOTION_DATABASE_ID,
  },
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
  },
  cron: {
    pollIntervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 2,
  },
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'phi3:mini',
  },
  paths: {
    processedEmails: 'data/processed-emails.json',
    categoryMap: 'data/category-map.json',
    knownSenders: 'data/known-senders.json',
    merchantDomains: 'data/merchant-domains.json',
  },
};

export default config;
