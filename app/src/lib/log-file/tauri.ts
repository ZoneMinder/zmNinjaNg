// Stub — real implementation lands in Task 8.
import type { LogFileStore } from './types';
import { NoopLogFileStore } from './noop';

export class TauriLogFileStore extends NoopLogFileStore implements LogFileStore {}
