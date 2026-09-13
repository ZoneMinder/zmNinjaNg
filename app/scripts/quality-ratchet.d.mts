// Types for the ESM ratchet script so the vitest gate can import it under tsc -b.
export const baselinePath: string;
export function internalMockFiles(files?: string[]): string[];
export function existenceAssertions(files?: string[]): number;
export function avoidedTerms(glossary?: string): Array<{ term: string; canonical: string }>;
export function avoidedTermHits(terms?: Array<{ term: string; canonical: string }>): number;
export function allProfilesIdRefs(files?: string[]): number;
export function fixedSleeps(files?: string[]): Record<string, number>;
export function currentCounts(): {
  internalMockFiles: number;
  existenceAssertions: number;
  avoidedTermHits: number;
  allProfilesIdRefs: number;
  fixedSleeps: number;
};
