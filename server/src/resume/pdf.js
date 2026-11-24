import { resumeHtml } from './draft.js';
import { launch } from '../apply/form.js';

// The resume as an ATS-friendly PDF (see resumeHtml), printed by a browser you already have open.
export async function pdfFromData(browser, data) {
  const page = await browser.newPage();
  try {
    await page.setContent(resumeHtml(data), { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ format: 'A4', margin: { top: '14mm', bottom: '14mm', left: '15mm', right: '15mm' } }));
  } finally {
    await page.close();
  }
}

// One shared hidden browser for every PDF (a new one per PDF costs seconds and memory), closed after a minute unused.
let browser = null; // a promise, so two PDFs at once share one launch
let users = 0;
let idle;
export async function makePdf(data) {
  clearTimeout(idle);
  users++;
  try {
    browser ??= launch(true)
      .then((b) => (b.on('disconnected', () => (browser = null)), b))
      .catch((err) => {
        browser = null;
        throw Object.assign(new Error(`Could not start the browser to make the PDF (${err.message}); on a server without Edge set APPLY_BROWSER_CHANNEL=chromium`), { status: 500 });
      });
    return await pdfFromData(await browser, data);
  } finally {
    if (--users === 0) {
      idle = setTimeout(async () => {
        const b = browser;
        browser = null;
        await (await b?.catch(() => null))?.close().catch(() => {});
      }, 60_000);
    }
  }
}
