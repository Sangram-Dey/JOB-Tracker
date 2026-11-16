// Decides whether a job belongs in your feed, using your preferences. Plain code, no AI, so it's free and instant.

// Boards write the same place in different ways. Your entry also matches these spellings.
// shortcut: hand-made alias list; add entries when a place you care about is missed.
const ALIASES = {
  'united states': ['usa', 'us', 'u.s.', 'united states of america'],
  'united kingdom': ['uk', 'england', 'great britain'],
  'united arab emirates': ['uae'],
  bengaluru: ['bangalore'],
  bangalore: ['bengaluru'],
  gurugram: ['gurgaon'],
  gurgaon: ['gurugram'],
  mumbai: ['bombay'],
  // Remote feeds often name a region instead of a country ("LATAM, Europe, APAC").
  india: ['apac', 'asia'],
};
const spellings = (names) => names.flatMap((n) => [n, ...(ALIASES[n.toLowerCase()] ?? [])]);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word, case-insensitive: "intern" must not match "internal", "US" must not match "Austin".
const mentions = (text, words) => words.some((w) => new RegExp(`(^|[^a-z0-9])${escape(w)}($|[^a-z0-9])`, 'i').test(text));

// "Remote", "Remote - Anywhere", "Anywhere in the World": a location that names no place at all.
const namesNoPlace = (text) =>
  !text.replace(/\b(remote|anywhere|worldwide|world|global|in|the|work from home|wfh|hybrid|flexible)\b|[^a-z]/gi, '');

export function matchesPreferences(job, prefs) {
  const title = job.title.replace(/[-/]/g, ' ');
  if (prefs.roles.length && !mentions(title, prefs.roles.map((r) => r.replace(/[-/]/g, ' ')))) return false;
  if (mentions(title, prefs.excludeKeywords)) return false;
  // unknown always passes the work-mode check: we'd rather show a job than silently lose it.
  if (job.workMode !== 'unknown' && !prefs.workModes.includes(job.workMode)) return false;

  const where = job.locations.join(' | ');
  const countries = spellings(prefs.countries);
  const inMyPlaces = !prefs.cities.length && !prefs.countries.length ? true : mentions(where, [...spellings(prefs.cities), ...countries]);

  if (job.workMode === 'remote') {
    // Remote jobs open to your countries, or remote with no country named (we can't tell, so keep it).
    if (prefs.remoteScope === 'anywhere' || !countries.length) return true;
    return mentions(where, countries) || namesNoPlace(where);
  }
  if (job.workMode === 'unknown') return inMyPlaces || (prefs.workModes.includes('remote') && namesNoPlace(where));
  return inMyPlaces; // hybrid / onsite: must be in one of your cities or countries
}
