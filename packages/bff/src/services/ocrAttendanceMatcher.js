/**
 * FOCIT LMS - OCR Attendance Matcher & Zero-Trust Line Corroborator
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements Refinement 4:
 * 1. Positional homoglyph normalization on numeric segments only (O/D->0, I/l->1, Z->2, S->5, B->8).
 * 2. Defeats the "Sequential Matric Collision" trap: Never uses unconstrained edit-distance <= 1
 *    on trailing serial digits across sequential cohort blocks.
 * 3. Composite line corroboration: Ambiguous or noisy matric tokens require horizontal line
 *    surname match before promoting confidence to 0.75.
 */

const NUMERIC_HOMOGLYPHS = {
  'O': '0',
  'D': '0',
  'o': '0',
  'I': '1',
  'l': '1',
  'L': '1',
  '|': '1',
  'Z': '2',
  'z': '2',
  'S': '5',
  's': '5',
  'B': '8',
};

/**
 * Normalizes positional homoglyphs in numeric segments of matric number strings.
 * e.g. "2O24/CSC/OO42" -> "2024/CSC/0042"
 */
export function normalizeMatricHomoglyphs(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().toUpperCase().replace(/\s+/g, '');

  // Split by slashes or delimiters: [Year, OptionalDept, Serial]
  const parts = trimmed.split('/');
  if (parts.length === 1) {
    // If unsegmented, normalize digits by checking typical position
    return trimmed.replace(/[ODILZS B]/g, (char) => NUMERIC_HOMOGLYPHS[char] || char);
  }

  const normalizedParts = parts.map((segment, idx) => {
    // First segment (Year: e.g. 2024) and Last segment (Serial: e.g. 00042) are strictly numeric
    if (idx === 0 || idx === parts.length - 1) {
      return segment.split('').map((char) => NUMERIC_HOMOGLYPHS[char] || char).join('');
    }
    // Middle segment (Dept code: e.g. CSC, MTH) is alphabetic
    return segment;
  });

  return normalizedParts.join('/');
}

/**
 * Extracts student surname from full name defensively.
 * e.g. "ADEYEMI Babatunde Oluwaseun" -> "ADEYEMI"
 */
export function extractStudentSurname(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  const tokens = fullName.trim().toUpperCase().split(/[\s,]+/);
  return tokens[0] || '';
}

/**
 * Evaluates whether an OCR text line matches an enrolled student.
 * Returns { isMatch: boolean, confidence: number, reason: string }
 */
export function matchStudentLine(ocrLine, student) {
  if (!ocrLine || !student || !student.matric_number) {
    return { isMatch: false, confidence: 0.0, reason: 'INVALID_INPUT' };
  }

  const lineUpper = ocrLine.toUpperCase();
  const canonicalMatric = student.matric_number.toUpperCase().replace(/\s+/g, '');
  const escapedCanonical = canonicalMatric.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m);
  
  // 1. Direct Canonical Token Match (Exact OCR Match)
  const exactRegex = new RegExp(`(^|[^A-Z0-9])${escapedCanonical}([^A-Z0-9]|$)`, 'i');
  if (exactRegex.test(lineUpper)) {
    return { isMatch: true, confidence: 1.000, reason: 'EXACT_CANONICAL_MATCH' };
  }

  // 2. Positional Homoglyph Normalization Match
  // Normalizes line tokens and compares against canonical matric
  const normalizedLine = lineUpper.split(/[\s,;|]+/).map(normalizeMatricHomoglyphs).join(' ');
  if (exactRegex.test(normalizedLine)) {
    return { isMatch: true, confidence: 0.950, reason: 'HOMOGLYPH_NORMALIZED_MATCH' };
  }

  // 3. Composite Line Corroboration:
  // If matric serial number has minor noise or OCR distortion, we DO NOT use edit distance alone
  // (which false-positives sequential classmates like 0041 vs 0042).
  // We REQUIRE horizontal line corroboration with the student's SURNAME.
  const surname = extractStudentSurname(student.full_name);
  if (surname && surname.length >= 3) {
    const surnameRegex = new RegExp(`(^|[^A-Z0-9])${surname}([^A-Z0-9]|$)`, 'i');
    const hasSurname = surnameRegex.test(lineUpper);

    if (hasSurname) {
      // Check if partial matric parts exist on the same line
      const parts = canonicalMatric.split('/');
      const serialPart = parts[parts.length - 1];
      const deptPart = parts.length > 2 ? parts[1] : '';

      const normalizedTokens = lineUpper.split(/[\s,;|]+/).map(normalizeMatricHomoglyphs);
      const matchesSerial = serialPart && normalizedTokens.some((t) => t.includes(serialPart));
      const matchesDept = !deptPart || lineUpper.includes(deptPart);

      if (matchesSerial || (matchesDept && normalizedTokens.some((t) => t.slice(-3) === serialPart.slice(-3)))) {
        return { isMatch: true, confidence: 0.750, reason: 'CORROBORATED_SURNAME_LINE_MATCH' };
      }
    }
  }

  // Under the 8-8-8 Doctrine: Uncorroborated sequential neighbor edit distance is zero-confidence ABSENT
  return { isMatch: false, confidence: 0.000, reason: 'NO_CORROBORATED_MATCH' };
}

