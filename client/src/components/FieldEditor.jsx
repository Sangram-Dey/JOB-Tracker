// A recursive form: it looks at the shape of the value and renders the right input.
//   string           -> text input (textarea for long text)
//   list of strings  -> textarea, one item per line
//   list of objects  -> a card per item, with Add / Remove
//   object           -> a group with one field per key
// So the whole profile is editable without writing a form per section.

// Blank items for "Add" buttons. Must match server/src/schemas/profile.js.
const BLANK = {
  experience: { company: '', title: '', location: '', startDate: '', endDate: '', bullets: [] },
  education: { institution: '', degree: '', field: '', startDate: '', endDate: '', grade: '' },
  projects: { name: '', description: '', link: '', tech: [], bullets: [] },
};
const LONG_TEXT = ['summary', 'description'];
// Singular names for "Add …" buttons.
const ITEM = { experience: 'role', education: 'education', projects: 'project' };

const pretty = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const isGroup = (v) => typeof v === 'object' && v !== null && !(Array.isArray(v) && v.every((x) => typeof x === 'string'));

export default function FieldEditor({ name, value, onChange, depth = 0 }) {
  const label = name && pretty(name);

  if (typeof value === 'string') {
    const long = LONG_TEXT.includes(name);
    const Tag = long ? 'textarea' : 'input';
    return (
      <label className={`block ${long ? 'sm:col-span-2' : ''}`}>
        <span className="text-xs font-medium text-muted">{label}</span>
        <Tag className="input mt-1" rows={5} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }

  if (Array.isArray(value) && !BLANK[name]) {
    return (
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium text-muted">{label}</span> <span className="text-xs text-faint">(one per line)</span>
        <textarea
          className="input mt-1"
          rows={Math.min(Math.max(value.length + 1, 3), 12)}
          value={value.join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n'))}
          // drop empty lines once you leave the box, so stray blank lines don't get saved
          onBlur={() => onChange(value.map((s) => s.trim()).filter(Boolean))}
        />
      </label>
    );
  }

  if (Array.isArray(value)) {
    return (
      <Section label={label} count={value.length}>
        <div className="space-y-3">
          {value.map((item, i) => (
            <div key={i} className="rounded-xl border border-line bg-paper/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldEditor value={item} depth={depth + 1} onChange={(v) => onChange(value.with(i, v))} />
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" className="btn-ghost text-danger hover:text-danger" onClick={() => onChange(value.toSpliced(i, 1))}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn-outline" onClick={() => onChange([...value, BLANK[name]])}>
            Add {ITEM[name] ?? name}
          </button>
        </div>
      </Section>
    );
  }

  const entries = Object.entries(value);
  const field = ([key, v]) => (
    <FieldEditor key={key} name={key} value={v} depth={depth + 1} onChange={(nv) => onChange({ ...value, [key]: nv })} />
  );

  // The whole profile: groups (Contact, Experience…) are sections; plain fields (Headline, Summary, Skills) share one.
  if (depth === 0) {
    const plain = entries.filter(([, v]) => !isGroup(v));
    return (
      <div className="divide-y divide-line">
        {entries.filter(([key, v]) => isGroup(v) && key === 'contact').map(field)}
        {plain.length > 0 && (
          <Section label="About you">
            <div className="grid gap-3 sm:grid-cols-2">{plain.map(field)}</div>
          </Section>
        )}
        {entries.filter(([key, v]) => isGroup(v) && key !== 'contact').map(field)}
      </div>
    );
  }
  if (!name) return entries.map(field); // an item inside a list card
  return (
    <Section label={label}>
      <div className="grid gap-3 sm:grid-cols-2">{entries.map(field)}</div>
    </Section>
  );
}

function Section({ label, count, children }) {
  return (
    <section className="py-7">
      <h2 className="mb-4 font-display text-lg font-semibold tracking-tight">
        {label}
        {count !== undefined && <span className="ml-2 text-sm font-normal text-faint">{count}</span>}
      </h2>
      {children}
    </section>
  );
}
