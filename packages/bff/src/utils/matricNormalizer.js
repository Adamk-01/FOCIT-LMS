/**
 * Senate Standard Matriculation Syntax: YYYY/NNNNN (4-digit year, slash, 4 to 6 digit serial)
 * Example: 2024/28682
 */
const SENATE_MATRIC_REGEX = /^(\d{4})\/(\d{4,6})$/;
const LOOSE_EXTRACTION_REGEX = /(\d{4})\s*[-/\\]\s*(\d{4,6})$/;

export function canonicalizeMatricNumber(rawInput) {
  if (typeof rawInput !== 'string') {
    return { valid: false, value: null, error: 'Matriculation number must be a string.' };
  }

  const trimmed = rawInput.trim().toUpperCase();

  // Fast path: check canonical format and year range
  const canonicalMatch = trimmed.match(SENATE_MATRIC_REGEX);
  if (canonicalMatch) {
    const year = Number.parseInt(canonicalMatch[1], 10);
    if (year >= 2000 && year <= 2100) {
      return { valid: true, value: trimmed, error: null };
    }
  }

  // Sanitization path: extract trailing YYYY and 4-6 digit serial from legacy formats (e.g., FOCIT/2024/28682 or 2024-28682)
  const match = trimmed.match(LOOSE_EXTRACTION_REGEX);
  if (match) {
    const [, yearStr, serialStr] = match;
    const year = Number.parseInt(yearStr, 10);
    if (year >= 2000 && year <= 2100) {
      return { valid: true, value: `${yearStr}/${serialStr}`, error: null };
    }
  }

  return {
    valid: false,
    value: null,
    error: 'Invalid Matriculation Number. Expected Senate Standard format YYYY/NNNNN (e.g., 2024/28682).',
  };
}
