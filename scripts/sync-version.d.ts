// Type declarations for the CommonJS build script sync-version.js so it can be
// imported from the app's vitest suite.

export function getBuildNumber(): number;
export function applyGradleVersion(text: string, version: string): string;
export function applyXcodeVersion(text: string, version: string): string;
export function buildNumberXcconfig(build: number): string;

declare const _default: {
  getBuildNumber: typeof getBuildNumber;
  applyGradleVersion: typeof applyGradleVersion;
  applyXcodeVersion: typeof applyXcodeVersion;
  buildNumberXcconfig: typeof buildNumberXcconfig;
};
export default _default;
