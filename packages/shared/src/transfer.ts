/** What the export file says it is, so an import can tell a Tandem board from any other JSON. */
export const EXPORT_FORMAT = 'tandem-board';
export const EXPORT_VERSION = 1;

/**
 * The largest import body, in bytes, as the client sends it (compact JSON).
 * It covers the biggest board LIMITS allow: 500 cards with 4000-character
 * descriptions in a three-byte script is about 6 MB.
 */
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024;

export const IMPORT_MESSAGES = {
  notAnExport: 'This file is not a Tandem board export.',
  tooLarge: 'This file is too large to import. The limit is 8 MB.',
} as const;
