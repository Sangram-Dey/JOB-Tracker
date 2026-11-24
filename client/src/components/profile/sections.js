// The list parts of a profile, described once and used by both the cards and the Add/Edit form (ItemCards.jsx).
// Field keys must match server/src/schemas/profile.js. type: text | textarea | lines (one per line) | tags (comma-separated).
const dates = (x) => [x.startDate, x.endDate].filter(Boolean).join(' – ');
const join = (...parts) => parts.filter(Boolean).join(' · ');

export const LIST_SECTIONS = {
  experience: {
    noun: 'experience',
    fields: [
      { key: 'title', label: 'Job title', required: true, placeholder: 'Software Engineer' },
      { key: 'company', label: 'Company', required: true, placeholder: 'CartNest' },
      { key: 'location', label: 'Location', placeholder: 'Bengaluru or Remote' },
      { key: 'startDate', label: 'Start', placeholder: 'Jul 2023', half: true },
      { key: 'endDate', label: 'End', placeholder: 'Present', half: true },
      { key: 'bullets', label: 'What you did', type: 'lines', hint: 'One achievement per line. Start with a verb; add a number where you know it.' },
    ],
    title: (x) => x.title || 'Untitled role',
    subtitle: (x) => join(x.company, x.location),
    meta: dates,
  },
  education: {
    noun: 'education',
    fields: [
      { key: 'degree', label: 'Degree', required: true, placeholder: 'B.Tech' },
      { key: 'field', label: 'Field of study', placeholder: 'Computer Science' },
      { key: 'institution', label: 'Institution', required: true, placeholder: 'VTU' },
      { key: 'startDate', label: 'Start', placeholder: '2017', half: true },
      { key: 'endDate', label: 'End', placeholder: '2021', half: true },
      { key: 'grade', label: 'Grade', placeholder: '8.2 CGPA' },
    ],
    title: (x) => join(x.degree, x.field) || 'Untitled degree',
    subtitle: (x) => x.institution,
    meta: (x) => join(dates(x), x.grade),
  },
  projects: {
    noun: 'project',
    fields: [
      { key: 'name', label: 'Project name', required: true, placeholder: 'Job Tracker' },
      { key: 'link', label: 'Link', placeholder: 'github.com/you/job-tracker' },
      { key: 'tech', label: 'Tech used', type: 'tags', placeholder: 'React, Node.js, MongoDB', hint: 'Separate with commas.' },
      { key: 'description', label: 'Description', type: 'textarea', placeholder: 'What it does, in one or two lines' },
      { key: 'bullets', label: 'Highlights', type: 'lines', hint: 'One per line.' },
    ],
    title: (x) => x.name || 'Untitled project',
    subtitle: (x) => x.link,
    meta: () => '',
  },
};

// An empty item in the schema's shape: lists empty, text "".
export const blankOf = (section) => Object.fromEntries(section.fields.map((f) => [f.key, ['lines', 'tags'].includes(f.type) ? [] : '']));
