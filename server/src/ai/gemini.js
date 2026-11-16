import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { httpError } from '../utils/httpError.js';

// Free-tier limits are per model (some allow only 20 requests a day), so several models are tried in order:
// when one is used up for the day, retired, or busy, the next one answers. Best quality first, lighter ones after.
// Picked on 2026-11-16 from a test of every model this key can use (correct structured answers, under 10 s).
// shortcut: Google renames and retires models often; edit GEMINI_MODELS in .env when one stops working.
export const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-3.5-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
export let lastModel = MODELS[0]; // the model that answered last (stored with AI reviews)
// shortcut: in memory, so a restart tries used-up models once more (one quick 429 each); fine for one server.
const restingUntil = new Map(); // model -> time it can be tried again

let gemini; // created on first use, so tests and startup don't need a key
// Timeout so a stuck request fails with an error instead of hanging forever.
const client = () => (gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 120_000 } }));

const isDaily = (err) => err.status === 429 && /PerDay/i.test(err.message ?? '');
// Google says when the quota frees up ("retryDelay":"69943s"); default to an hour.
const retryAfterMs = (err) => Number(String(err.message).match(/"retryDelay":"(\d+)s"/)?.[1] ?? 3600) * 1000;

// One model, with a short retry for a busy moment. 504 = Google's deadline ran out while it was thinking:
// the retry thinks less so it finishes.
async function ask(model, request) {
  let fast = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await client().models.generateContent({
        model,
        contents: request.contents,
        config: { ...request.config, ...(fast && { thinkingConfig: { thinkingLevel: 'low' } }) },
      });
    } catch (err) {
      if (![500, 503, 504].includes(err.status) || attempt >= 2) throw err;
      if (err.status === 504) fast = true;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// One structured-output call: Gemini must answer JSON in the Zod schema's shape, and the answer is validated
// again here, because model output is untrusted until checked.
export async function generateJson({ system, parts, schema, what }) {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema);
  const request = { contents: [{ role: 'user', parts }], config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: jsonSchema } };
  let response;
  let lastErr;
  for (const model of MODELS) {
    if ((restingUntil.get(model) ?? 0) > Date.now()) continue;
    try {
      response = await ask(model, request);
      lastModel = model;
      break;
    } catch (err) {
      lastErr = err;
      if (isDaily(err)) restingUntil.set(model, Date.now() + retryAfterMs(err));
      else if (err.status === 404) restingUntil.set(model, Date.now() + 7 * 86_400_000); // retired for new users
      // used up, retired, rate-limited this minute, or busy: the next model may answer; anything else is our bug
      if (![404, 429, 500, 503, 504].includes(err.status)) break;
    }
  }
  if (!response) {
    const err = lastErr ?? {};
    const allDaily = MODELS.every((m) => (restingUntil.get(m) ?? 0) > Date.now());
    const msg =
      allDaily ? "Gemini's free daily limits are used up on every model; they reset tomorrow"
      : err.status === 429 ? 'Gemini free-tier limit reached, try again in a minute'
      : err.status === 503 ? 'Gemini is busy right now, try again in a minute'
      : err.status === 504 ? 'Gemini took too long to answer, try again'
      : 'Gemini request failed';
    throw Object.assign(httpError(err.status === 429 || allDaily ? 429 : 502, msg), { cause: lastErr });
  }
  let json;
  try {
    json = JSON.parse(response.text ?? '');
  } catch {
    json = undefined;
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    console.error(`Gemini returned an invalid ${what}:`, response.text?.slice(0, 500), result.error?.issues);
    throw httpError(502, `Gemini could not ${what} (finish reason: ${response.candidates?.[0]?.finishReason})`);
  }
  return result.data;
}
