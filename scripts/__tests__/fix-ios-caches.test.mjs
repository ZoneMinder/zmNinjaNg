import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evictedFrameworks, isSpmCacheCorruption, ownedSourcePackages } from '../fix-ios-caches.mjs';

test('recognises the CLI shape of a gutted cache', () => {
  const output =
    "the package manifest at '/Users/x/Library/Developer/Xcode/DerivedData/App-abc/" +
    "SourcePackages/checkouts/capacitor-swift-pm/Package.swift' cannot be accessed";

  assert.equal(isSpmCacheCorruption(output), true);
});

test('recognises the bare-clone shape of a gutted cache', () => {
  const output =
    "/Users/x/SourcePackages/repositories/leveldb-a66e184b is not valid git repository " +
    "for 'https://github.com/firebase/leveldb.git', will fetch again.";

  assert.equal(isSpmCacheCorruption(output), true);
});

test('recognises the label Xcode puts on it', () => {
  assert.equal(isSpmCacheCorruption("Missing package product 'CapApp-SPM'"), true);
});

test('leaves an unrelated build failure alone', () => {
  const output = "error: no such module 'Capacitor'\n** BUILD FAILED **";

  assert.equal(isSpmCacheCorruption(output), false);
});

test('claims only the SourcePackages trees that name this checkout', () => {
  const entries = [
    { path: '/dd/App-ours/SourcePackages', state: '{"object":{"dependencies":[{"subpath":"/me/proj/app/node_modules/x"}]}}' },
    { path: '/dd/App-theirs/SourcePackages', state: '{"object":{"dependencies":[{"subpath":"/other/proj/node_modules/x"}]}}' },
    { path: '/dd/App-unreadable/SourcePackages', state: null },
  ];

  assert.deepEqual(ownedSourcePackages(entries, '/me/proj'), ['/dd/App-ours/SourcePackages']);
});

test('names the framework products the system has taken files out of', () => {
  const frameworks = [
    { path: '/dd/udid/Build/Products/Debug-iphoneos/Capacitor.framework', hasInfoPlist: false },
    { path: '/dd/udid/Build/Products/Debug-iphoneos/Cordova.framework', hasInfoPlist: false },
    { path: '/dd/udid/Build/Products/Debug-iphoneos/llama.framework', hasInfoPlist: true },
  ];

  assert.deepEqual(evictedFrameworks(frameworks), [
    '/dd/udid/Build/Products/Debug-iphoneos/Capacitor.framework',
    '/dd/udid/Build/Products/Debug-iphoneos/Cordova.framework',
  ]);
});

test('leaves an intact built-products tree alone', () => {
  const frameworks = [{ path: '/dd/udid/Build/Products/Debug-iphoneos/Capacitor.framework', hasInfoPlist: true }];

  assert.deepEqual(evictedFrameworks(frameworks), []);
});
