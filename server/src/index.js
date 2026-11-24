import './config/env.js'; // first: stops at once if a required setting is missing
import { connectDb } from './config/db.js';
import { app } from './app.js';
import { startSchedule } from './jobs/scrape.js';
import { resumeQueues } from './mail/queue.js';
import { prepareMornings } from './mail/prepare.js';
import { recoverInterrupted } from './apply/run.js';
import { recoverTailoring } from './resume/tailorJob.js';
import { checkAllInboxes } from './tracker/inbox.js';
import { sendDailySummaries } from './tracker/summary.js';
import { cleanupDaily } from './jobs/cleanup.js';

await connectDb(); // stops the server if MongoDB can't be reached

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
startSchedule(); // automatic job searches every 6 hours
resumeQueues(); // finish sending emails that were queued before a restart
recoverInterrupted().catch(console.error); // auto-apply work cut off by a restart can be retried
recoverTailoring().catch(console.error); // so is resume tailoring
// Every 30 minutes: send ones held back by yesterday's daily limit, prepare the morning's emails once a day,
// check Gmail for replies (moves Tracker cards), send the morning summary email once a day, and clean up old records daily.
const everyHalfHour = () => {
  resumeQueues().catch(console.error);
  prepareMornings().catch(console.error);
  checkAllInboxes().catch(console.error);
  sendDailySummaries().catch(console.error);
  cleanupDaily().catch((err) => console.error('Cleanup failed:', err.message));
};
setInterval(everyHalfHour, 30 * 60_000);
setTimeout(everyHalfHour, 90_000); // also shortly after start
