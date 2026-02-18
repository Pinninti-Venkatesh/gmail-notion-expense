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
  logger.info('  GET  /api/health           - Health check');
  logger.info('  GET  /api/auth             - Start Gmail OAuth');
  logger.info('  GET  /api/auth/callback    - OAuth callback');
  logger.info('  POST /api/sync             - Manual email poll');
  logger.info('  POST /api/sync-categories  - Learn categories from Notion');
  logger.info('  GET  /api/categories       - View category map');

  startCron();
});
