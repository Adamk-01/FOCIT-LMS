/**
 * Senate Standard Matriculation Syntax: YYYY/NNNNN (4-digit year, slash, exactly 5-digit serial)
 * Example: 2023/47162
 */
const SENATE_MATRIC_REGEX = /^(\d{4})\/(\d{5})$/;
const LOOSE_EXTRACTION_REGEX = /(\d{4})\s*[-/\\]\s*(\d{5})$/;

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

  // Sanitization path: extract trailing YYYY and 5-digit serial from legacy formats (e.g., FOCIT/2023/47162 or 2023-47162)
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
    error: 'Invalid Matriculation Number. UNIOSUN matric numbers require 5 digits after the year (e.g., 2023/47162).',
  };
}
