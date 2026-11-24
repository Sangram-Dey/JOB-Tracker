// Settings the server can't start without. Imported first by index.js, so a missing one stops startup
// with one message listing all of them, instead of failing later somewhere deep in the code.
const REQUIRED = ['MONGODB_URI', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'GEMINI_API_KEY', 'MAIL_SECRET_KEY'];

const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(`Missing in server/.env: ${missing.join(', ')}. Copy server/.env.example to server/.env and fill them in.`);
  process.exit(1);
}
