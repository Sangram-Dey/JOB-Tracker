import { getAuth } from '@clerk/express';

// clerkMiddleware() in app.js has already checked the Clerk session token on this request.
// Here we only reject signed-out requests (with JSON, not a redirect) and expose the Clerk user id.
export function requireAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Not signed in' });
  req.userId = userId; // e.g. "user_2abc…": every document is stored under this id
  next();
}
