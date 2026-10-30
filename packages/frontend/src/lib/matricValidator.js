export const SENATE_MATRIC_PATTERN = /^\d{4}\/\d{4,6}$/;

/**
 * Formats user keystrokes into YYYY/NNNNN in real time without trapping backspace.
 */
export function formatMatricInput(raw) {
  const digitsAndSlash = raw.replace(/[^\d/-]/g, '').replace('-', '/');
  const digitsOnly = digitsAndSlash.replace(/\D/g, '');

  if (digitsOnly.length <= 4) {
    return digitsOnly;
  }
  return `${digitsOnly.slice(0, 4)}/${digitsOnly.slice(4, 10)}`;
}

export function validateSenateMatric(value) {
  if (!value || !SENATE_MATRIC_PATTERN.test(value.trim())) {
    return 'Enter your matriculation number in the format YYYY/NNNNN (e.g., 2024/28682).';
  }
  return null;
}
