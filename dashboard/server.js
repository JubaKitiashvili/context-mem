#!/usr/bin/env node
'use strict';

/**
 * context-mem dashboard — entry point
 *
 * Usage:
 *   node dashboard/server.js [--port 51893] [--db path/to/store.db]
 *   context-mem dashboard
 *
 * Implementation is split across dashboard/server/:
 *   index.js          — main() orchestration (DB, HTTP, WS, shutdown)
 *   http.js           — HTTP server + SSE + page routing
 *   api.js            — JSON API endpoints
 *   html-templates.js — HTML page shells
 *   queries.js        — SQLite query helpers
 */

const { main } = require('./server/index.js');
main().catch(err => { console.error(err); process.exit(1); });
