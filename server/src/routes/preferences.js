import { Router } from 'express';
import { Profile } from '../models/Profile.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rescoreUser } from '../jobs/score.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const profile = await Profile.findOne({ userId: req.userId });
  // Parsing fills in defaults for fields added after these preferences were saved.
  res.json(PreferencesSchema.parse(profile?.preferences ?? {}));
});

router.put('/', async (req, res) => {
  const preferences = PreferencesSchema.parse(req.body);
  await Profile.updateOne({ userId: req.userId }, { preferences }, { upsert: true });
  await rescoreUser(req.userId); // cities, roles, pay and years all feed the fit score
  res.json(preferences);
});

export default router;
