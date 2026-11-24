import { getAuth, clerkClient } from '@clerk/express';

// clerkMiddleware() in app.js has already checked the Clerk session token on this request.
// Here we reject signed-out requests (with JSON, not a redirect) and expose the Clerk user id.
// ALLOWED_EMAILS (comma-separated) makes the app private: only those verified emails get in. Empty = anyone who signs up.
const allowList = () =>
  (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
const allowed = new Map(); // userId -> true/false, so Clerk is asked once per user (until restart)

export async function isAllowed(userId, list = allowList()) {
  if (!list.length) return true;
  if (!allowed.has(userId)) {
    const user = await clerkClient.users.getUser(userId);
    allowed.set(userId, user.emailAddresses.some((e) => e.verification?.status === 'verified' && list.includes(e.emailAddress.toLowerCase())));
  }
  return allowed.get(userId);
}

export async function requireAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Not signed in' });
  if (!(await isAllowed(userId))) return res.status(403).json({ error: 'This Job Tracker is private. Ask its owner to add your email.' });
  req.userId = userId; // e.g. "user_2abc…": every document is stored under this id
  next();
}
