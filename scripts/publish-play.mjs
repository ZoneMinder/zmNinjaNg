#!/usr/bin/env node
/**
 * Upload an Android App Bundle to Google Play with its release notes.
 *
 * The notes come from the same developer notice the App Store gets, so both
 * stores publish the text a human already reviewed during make_release. Play
 * allows a fifth of Apple's budget, so a long notice is compressed rather than
 * cut, and nothing is uploaded until the final text has been shown and
 * accepted.
 *
 * The bundle lands on the production track as a draft. Nothing reaches users
 * until you start the rollout in the Play Console.
 *
 * Credentials: a Google Play service account key at
 *   ~/.playconsole/service-account.json
 * kept outside the repository. Unlike Apple's key this file is a full
 * credential: it carries its own private key and needs no second identifier.
 *
 * Usage: node scripts/publish-play.mjs --aab <path> --version <x.y.z>
 */

import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAY_MAX, fitToLimit, releaseNoticeFor, toPlainNotes } from './release-notes.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';
const PACKAGE = 'com.zoneminder.zmNinjaNG';
const LANGUAGE = 'en-US';

/** Production, unreleased. Starting the rollout stays a deliberate human step. */
const TRACK = 'production';
const STATUS = 'draft';

const KEY_PATH = join(homedir(), '.playconsole/service-account.json');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

/** An OAuth access token for the Play Developer API, from the service account. */
async function accessToken() {
  let key;
  try {
    key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
  } catch {
    throw new Error(`No Play service account key at ${KEY_PATH}. See docs/building/ANDROID.rst.`);
  }
  const now = Math.floor(Date.now() / 1000);
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = [
    encode({ alg: 'RS256', typ: 'JWT' }),
    encode({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  ].join('.');
  const assertion = `${input}.${createSign('RSA-SHA256').update(input).sign(key.private_key, 'base64url')}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Play auth failed (${response.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

async function call(token, method, url, { body, contentType } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    ...(body ? { body } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Notes that fit Play's budget. Compression keeps every change; dropping lines
 * loses one silently, so Claude is tried first and the caller sees the result.
 */
function compress(plain) {
  if (plain.length <= PLAY_MAX) return { text: plain, dropped: [], compressed: false };

  try {
    const out = execFileSync('claude', ['-p', [
      `Shorten these Google Play release notes to at most ${PLAY_MAX} characters.`,
      'Keep every bullet: shorten the wording, never drop an item. Keep the "- " bullet format, one per line.',
      'Plain language, no jargon, no marketing words, no em-dashes, no first person.',
      'Output only the bullets, no preamble, no code fence.',
      '',
      plain,
    ].join('\n')], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    if (out && out.length <= PLAY_MAX) return { text: out, dropped: [], compressed: true };
    console.warn(`Claude returned ${out.length} characters, still over ${PLAY_MAX}. Trimming instead.`);
  } catch (error) {
    const why = error?.code === 'ENOENT' ? 'claude CLI not on PATH' : error?.message;
    console.warn(`Could not compress with Claude (${why}). Trimming instead.`);
  }

  return { ...fitToLimit(plain, PLAY_MAX), compressed: false };
}

async function main() {
  const aabPath = arg('aab');
  const version = arg('version');
  if (!aabPath || !version) {
    console.error('Usage: node scripts/publish-play.mjs --aab <path> --version <x.y.z>');
    return 1;
  }

  const notices = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/notices.json'), 'utf8'));
  const notice = releaseNoticeFor(notices, version);
  if (!notice) {
    console.error(`No release notice for ${version} in docs/notices.json.`);
    console.error('Add the notice, or set the release notes by hand in the Play Console.');
    return 1;
  }

  const { text: notes, dropped, compressed } = compress(toPlainNotes(notice.body));
  console.log(`\nRelease notes for ${version} (${notes.length}/${PLAY_MAX} characters${compressed ? ', compressed' : ''}):\n`);
  console.log(notes.split('\n').map((l) => `  ${l}`).join('\n'));
  if (dropped.length) {
    console.log(`\n⚠️  ${dropped.length} line(s) did not fit and will NOT reach Play:\n`);
    console.log(dropped.map((l) => `  ${l}`).join('\n'));
  }
  const answer = await ask(`\nUpload to the Play ${TRACK} track as a ${STATUS}? [y/N] `);
  if (!/^[Yy]/.test(answer)) {
    console.log('Aborted. Nothing was uploaded.');
    return 0;
  }

  const token = await accessToken();
  const app = `${API}/applications/${PACKAGE}`;

  console.log('Opening a Play edit...');
  const edit = await call(token, 'POST', `${app}/edits`);

  console.log(`Uploading ${aabPath}...`);
  const bundle = await call(token, 'POST', `${UPLOAD}/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`, {
    body: readFileSync(aabPath),
    contentType: 'application/octet-stream',
  });
  console.log(`Uploaded version code ${bundle.versionCode}.`);

  console.log(`Assigning to ${TRACK}...`);
  await call(token, 'PUT', `${app}/edits/${edit.id}/tracks/${TRACK}`, {
    body: JSON.stringify({
      track: TRACK,
      releases: [{
        versionCodes: [String(bundle.versionCode)],
        status: STATUS,
        releaseNotes: [{ language: LANGUAGE, text: notes }],
      }],
    }),
    contentType: 'application/json',
  });

  await call(token, 'POST', `${app}/edits/${edit.id}:commit`);
  console.log(`\n✅ ${version} (code ${bundle.versionCode}) is a ${STATUS} on the Play ${TRACK} track.`);
  console.log('   Start the rollout in the Play Console when you are ready.');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\n❌ Play upload failed: ${error.message}`);
      process.exit(1);
    });
}
