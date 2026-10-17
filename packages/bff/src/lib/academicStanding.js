/**
 * Tier 3 Compute Plane: Senate Policy 100L/200L GPA Exemption Evaluator
 * Enforces Invariant 2: Foundational students taking inter-faculty courses 
 * are strictly exempt from Faculty CGPA calculation until 300L specialization.
 */
export function evaluateGpaStanding(student) {
  const level = Number(student?.level || 100);
  const isGpaExempt = level < 300;

  if (isGpaExempt) {
    return {
      current_gpa: null,
      gpa_exempt: true,
      standing_label: 'EXEMPT (100L/200L Inter-Faculty)',
      exemption_reason:
        '100L & 200L foundational inter-faculty courses are excluded from Faculty CGPA computation until 300L departmental core progression.',
    };
  }

  const numericGpa =
    student?.current_gpa !== null && student?.current_gpa !== undefined
      ? parseFloat(student.current_gpa)
      : 0.0;

  let standingLabel = 'Good Standing';
  if (numericGpa >= 4.5) standingLabel = 'First Class Standing';
  else if (numericGpa >= 3.5) standingLabel = 'Second Class Upper (2:1)';
  else if (numericGpa >= 2.4) standingLabel = 'Second Class Lower (2:2)';
  else if (numericGpa >= 1.5) standingLabel = 'Third Class';
  else standingLabel = 'Academic Probation';

  return {
    current_gpa: Number(numericGpa.toFixed(2)),
    gpa_exempt: false,
    standing_label: standingLabel,
    exemption_reason: null,
  };
}

export default { evaluateGpaStanding };
