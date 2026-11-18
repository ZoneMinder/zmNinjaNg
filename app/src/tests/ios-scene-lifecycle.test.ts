/**
 * Apps built with the iOS 27 SDK fail to launch unless they adopt the UIScene
 * life cycle (refs #587). The scene manifest in Info.plist must name the
 * SceneDelegate class defined in AppDelegate.swift and load Main.storyboard.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const iosApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ios/App/App');
const plist = fs.readFileSync(path.join(iosApp, 'Info.plist'), 'utf8');
const appDelegate = fs.readFileSync(path.join(iosApp, 'AppDelegate.swift'), 'utf8');

describe('iOS UIScene life cycle', () => {
  it('Info.plist declares a scene manifest that loads Main through SceneDelegate', () => {
    const start = plist.indexOf('<key>UIApplicationSceneManifest</key>');
    expect(start).toBeGreaterThan(-1);
    const manifest = plist.slice(start);
    expect(manifest).toMatch(/<key>UISceneDelegateClassName<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/);
    expect(manifest).toMatch(/<key>UISceneStoryboardFile<\/key>\s*<string>Main<\/string>/);
  });

  it('SceneDelegate exists and the app delegate no longer owns the window', () => {
    expect(appDelegate).toMatch(/class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
    expect(appDelegate).not.toMatch(/class AppDelegate[^{]*\{\s*var window/);
  });
});
