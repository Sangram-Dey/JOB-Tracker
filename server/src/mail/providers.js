// Email providers a user can connect with an app password: where to send (SMTP) and where to read replies (IMAP).
// Adding a provider is one entry here plus its steps in client/src/components/MailAccount.jsx.
// Outlook.com is left out on purpose: Microsoft is removing app-password logins, so it needs "Sign in with Microsoft".
export const PROVIDERS = {
  gmail: { name: 'Gmail', smtp: 'smtp.gmail.com', imap: 'imap.gmail.com', domains: /@(gmail|googlemail)\.com$/i },
  yahoo: { name: 'Yahoo Mail', smtp: 'smtp.mail.yahoo.com', imap: 'imap.mail.yahoo.com', domains: /@(yahoo|ymail|rocketmail)\.[a-z.]+$/i },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);

// The provider an address belongs to, or null (a work address on Google, say: the user picks it).
export const providerFor = (email) => PROVIDER_IDS.find((id) => PROVIDERS[id].domains.test(email ?? '')) ?? null;
