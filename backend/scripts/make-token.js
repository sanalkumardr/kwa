#!/usr/bin/env node
// Mint a dev JWT for testing the API.
//   node scripts/make-token.js [appUserId] [jwtSecret]
// Defaults to EE Menon (seed migration 003) and the compose dev secret.
const jwt = require('jsonwebtoken');

const sub = process.argv[2] || '22222222-0000-0000-0000-000000000001';
const secret = process.argv[3] || process.env.JWT_SECRET || 'dev-secret-change-me';

const token = jwt.sign({ sub }, secret, { expiresIn: '12h' });
process.stdout.write(token + '\n');
