// Builds the Express app. Kept separate from server.js so tests can use it without opening a port.
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { config } = require('./config');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: config.frontendUrl.split(',').map((url) => url.trim()) }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
