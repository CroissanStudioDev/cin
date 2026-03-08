/**
 * Standard CLI exit codes
 * Based on common conventions and sysexits.h
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  MISUSE: 2, // Invalid arguments or usage
  CONFIG_ERROR: 10,
  AUTH_ERROR: 11,
  NETWORK_ERROR: 12,
  VALIDATION_ERROR: 13,
  FILE_ERROR: 14,
  TIMEOUT: 15,
  DEPENDENCY_ERROR: 16,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
