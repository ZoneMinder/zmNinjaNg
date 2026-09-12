#!/usr/bin/env node
/**
 * Set the App Store "What's New" text for a version from its developer notice.
 *
 * The release notice in docs/notices.json is already the right text: written
 * for users, titled "What's new in zmNinjaNg X.Y.Z", and reviewed by a human
 * during make_release. Retyping it into App Store Connect after every upload is
 * the step that gets skipped, so a release ships with last version's notes.
 *
 * Uploading a build does not carry release notes with it, so this talks to the
 * App Store Connect API directly: mint a JWT with the same .p8 the upload uses,
 * find or create the version record, and patch its English localization.
 *
 * Not fatal to a release. The build is already uploaded by the time this runs,
 * and the text can always be typed in by hand, so a failure here reports and
 * exits non-zero without unwinding anything.
 *
 * Usage: ASC_KEY_ID=... ASC_ISSUER_ID=... node scripts/set-whats-new.mjs 2.4.0
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_STORE_MAX, fitToLimit, releaseNoticeFor, toPlainNotes } from './release-notes.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.appstoreconnect.apple.com/v1';
const BUNDLE_ID = 'com.zoneminder.zmNinjaNG';
const LOCALE = 'en-US';

/**
 * A bearer token for the App Store Connect API, signed with the team key.
 * ES256 wants the raw r||s signature, not the DER form Node emits by default.
 */
function token(keyId, issuerId) {
  const key = readFileSync(join(homedir(), '.appstoreconnect/private_keys', `AuthKey_${keyId}.p8`));
  const now = Math.floor(Date.now() / 1000);
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = [
    encode({ alg: 'ES256', kid: keyId, typ: 'JWT' }),
    encode({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }),
  ].join('.');
  const signature = createSign('SHA256')
    .update(input)
    .sign({ key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${input}.${signature}`;
}

async function call(bearer, method, path, body) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${method} ${path} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
}

async function main() {
  const version = process.argv[2];
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  if (!version || !keyId || !issuerId) {
    console.error('Usage: ASC_KEY_ID=... ASC_ISSUER_ID=... node scripts/set-whats-new.mjs <version>');
    return 1;
  }

  const notices = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/notices.json'), 'utf8'));
  const notice = releaseNoticeFor(notices, version);
  if (!notice) {
    console.error(`No release notice for ${version} in docs/notices.json.`);
    console.error("Set What's New by hand in App Store Connect, or add the notice and re-run.");
    return 1;
  }
  const { text: whatsNew, dropped } = fitToLimit(toPlainNotes(notice.body), APP_STORE_MAX);
  if (dropped.length) console.warn(`Notes over ${APP_STORE_MAX} characters; dropped ${dropped.length} line(s).`);

  const bearer = token(keyId, issuerId);
  const apps = await call(bearer, 'GET', `/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) throw new Error(`No app with bundle id ${BUNDLE_ID} on this account`);

  const existing = await call(
    bearer,
    'GET',
    `/apps/${app.id}/appStoreVersions?filter[versionString]=${version}&filter[platform]=IOS`,
  );
  let appStoreVersion = existing.data[0];
  if (!appStoreVersion) {
    console.log(`Creating App Store version ${version}...`);
    const created = await call(bearer, 'POST', '/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: { versionString: version, platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    appStoreVersion = created.data;
  }

  const localizations = await call(
    bearer,
    'GET',
    `/appStoreVersions/${appStoreVersion.id}/appStoreVersionLocalizations`,
  );
  const localization = localizations.data.find((l) => l.attributes.locale === LOCALE);
  if (!localization) throw new Error(`Version ${version} has no ${LOCALE} localization`);

  await call(bearer, 'PATCH', `/appStoreVersionLocalizations/${localization.id}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: localization.id,
      attributes: { whatsNew },
    },
  });

  console.log(`Set What's New for ${version} (${whatsNew.length} characters).`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`Could not set What's New: ${error.message}`);
      // An already-released version is read-only; that is expected, not a bug.
      console.error('If the version is already Ready for Sale, edit it in App Store Connect instead.');
      process.exit(1);
    });
}
