import express from 'express';
import config from './config/index.js';
import apiRoutes from './routes/api.js';
import { startCron } from './scheduler/cron-job.js';
import logger from './utils/logger.js';

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

app.listen(config.server.port, () => {
  logger.info(`Server running on http://localhost:${config.server.port}`);
  logger.info('Endpoints:');
  logger.info('  GET  /api/health           - Health check (includes Ollama status)');
  logger.info('  GET  /api/auth             - Start Gmail OAuth');
  logger.info('  GET  /api/auth/callback    - OAuth callback');
  logger.info('  POST /api/sync             - Manual email poll');
  logger.info('  POST /api/sync-categories  - Learn categories from Notion');
  logger.info('  GET  /api/categories       - View category map');
  logger.info('  GET  /api/known-senders    - View auto-learned senders');
  logger.info('  POST /api/known-senders    - Add a known sender');
  logger.info('  GET  /api/merchant-domains - View merchant domain map');
  logger.info('  POST /api/merchant-domains - Add merchant domain mapping');

  startCron();
});
