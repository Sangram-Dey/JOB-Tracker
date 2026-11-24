import express from 'express';
import { clerkMiddleware } from '@clerk/express';
import multer from 'multer';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import profileRoutes from './routes/profile.js';
import preferencesRoutes from './routes/preferences.js';
import jobsRoutes from './routes/jobs.js';
import contactsRoutes from './routes/contacts.js';
import outreachRoutes from './routes/outreach.js';
import atsRoutes from './routes/ats.js';
import applyRoutes from './routes/apply.js';
import trackerRoutes from './routes/tracker.js';
import resumeRoutes from './routes/resume.js';
import tailorRoutes from './routes/tailor.js';

// The Express app lives here, separate from index.js (which connects to Mongo and listens),
// so tests can start the app without a database.
export const app = express();

app.use(express.json({ limit: '1mb' }));
// Reads the Clerk session (the __session cookie, or an Authorization: Bearer token) and verifies it
// with CLERK_SECRET_KEY. It never blocks a request by itself; requireAuth does that per route.
app.use(clerkMiddleware());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 });
});
app.use('/api/profile', profileRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/ats', atsRoutes);
app.use('/api/resume', resumeRoutes);
app.use('/api/tailor', tailorRoutes);
app.use('/api/apply', applyRoutes);
app.use('/api/tracker', trackerRoutes);

// In production, Express also serves the built React app (client/dist): one server, one domain, no CORS.
const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res, next) => res.sendFile('index.html', { root: clientDist }, (err) => err && next()));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// One place turns every thrown error into a JSON response. Express 5 forwards errors from async handlers here.
app.use((err, req, res, next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid data', issues: err.issues });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
});
