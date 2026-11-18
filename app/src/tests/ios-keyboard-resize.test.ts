/**
 * iOS keeps the webview full height when the keyboard opens and scrolls the
 * page instead, so `dvh` never shrinks and dialogs end up under the keyboard
 * (refs #587). The Keyboard plugin's native resize shrinks the webview itself.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../package.json';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = fs.readFileSync(path.join(appDir, 'capacitor.config.ts'), 'utf8');

describe('iOS keyboard resize', () => {
  it('shrinks the webview above the keyboard instead of scrolling the page', () => {
    expect(Object.keys(pkg.dependencies)).toContain('@capacitor/keyboard');
    expect(config).toMatch(/Keyboard:\s*\{\s*resize:\s*'native'/);
  });
});
