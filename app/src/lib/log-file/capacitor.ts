// Stub — real implementation lands in Task 5.
import type { LogFileStore } from './types';
import { NoopLogFileStore } from './noop';

export class CapacitorLogFileStore extends NoopLogFileStore implements LogFileStore {}
