import { Application } from '../models/Application.js';
import { AutoApply } from '../models/AutoApply.js';
import { Tracked, STAGES } from '../models/Tracked.js';

// Adds a Tracker card for every email you sent and every form that was applied, once.
// Called before the board is shown and before the inbox check, so it also fills in older applications.
export async function syncTracked(userId) {
  const [mails, forms] = await Promise.all([
    Application.find({ userId, status: 'sent' }, 'jobId company jobTitle to messageId sentAt resumePdfId'),
    AutoApply.find({ userId, status: 'applied' }, 'jobId company title formUrl appliedAt updatedAt resumePdfId'),
  ]);
  const card = (sourceId, fields) => ({
    updateOne: {
      filter: { userId, sourceId },
      // $setOnInsert: an existing card (maybe moved or noted by you) is never changed
      update: { $setOnInsert: { ...fields, userId, sourceId, stage: 'applied', notes: '', unread: false, history: [{ stage: 'applied', at: fields.appliedAt, by: 'app' }] } },
      upsert: true,
    },
  });
  const ops = [
    ...mails.map((a) => card(a._id, { kind: 'email', jobId: a.jobId, company: a.company || a.to.split('@')[1], role: a.jobTitle, to: a.to.toLowerCase(), messageId: a.messageId, appliedAt: a.sentAt ?? new Date(), tailoredResume: Boolean(a.resumePdfId) })),
    ...forms.map((a) => card(a._id, { kind: 'form', jobId: a.jobId, company: a.company, role: a.title, url: a.formUrl, appliedAt: a.appliedAt ?? a.updatedAt, tailoredResume: Boolean(a.resumePdfId) })),
  ];
  if (ops.length) await Tracked.bulkWrite(ops, { ordered: false });
}

// Inbox moves are forward only (applied < replied < interview < rejected < offer); you can move a card anywhere.
export const isForward = (from, to) => STAGES.indexOf(to) > STAGES.indexOf(from) && from !== 'offer';

export function moveTo(card, stage, by) {
  if (card.stage === stage) return false;
  card.stage = stage;
  card.history.push({ stage, at: new Date(), by });
  return true;
}
