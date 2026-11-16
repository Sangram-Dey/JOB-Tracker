import mongoose from 'mongoose';
import { app } from './app.js';
import { startSchedule } from './jobs/scrape.js';
import { resumeQueues } from './mail/queue.js';
import { prepareMornings } from './mail/prepare.js';
import { recoverInterrupted } from './apply/run.js';

for (const key of ['MONGODB_URI', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'GEMINI_API_KEY']) {
  if (!process.env[key]) throw new Error(`Missing ${key}: copy server/.env.example to server/.env and fill it in`);
}

await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to MongoDB');

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
startSchedule(); // automatic job searches every 6 hours
resumeQueues(); // finish sending emails that were queued before a restart
recoverInterrupted().catch(console.error); // auto-apply work cut off by a restart can be retried
// Every 30 minutes: send ones held back by yesterday's daily limit, and prepare the morning's emails once a day.
setInterval(() => {
  resumeQueues().catch(console.error);
  prepareMornings().catch(console.error);
}, 30 * 60_000);
setTimeout(() => prepareMornings().catch(console.error), 90_000); // also shortly after start
