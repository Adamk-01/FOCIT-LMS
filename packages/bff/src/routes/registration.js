/**
 * FOCIT LMS - Academic Course Registration Route Handler
 *
 * Exposes the Academic Governance Plane:
 * 1. GET /current & GET /eligible -> Current registration state, active batch, and eligible catalog
 * 2. PUT /draft                   -> Idempotent draft persistence ($0 \le U \le 24$, zero capacity locks)
 * 3. POST /submit                 -> Set-Difference CTE, floor/ceiling bounds, capacity reservation
 * 4. GET /advisor/cohort          -> Level Advisor cohort inspection with status/level filters
 * 5. POST /advisor/batch-approve  -> Dijkstra-ordered DAG bulk approval & enrollment creation
 * 6. POST /advisor/reject         -> Idempotent capacity reversion & Senate remarks recording
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getCurrentRegistrationState,
  saveRegistrationDraft,
  submitRegistration,
  getAdvisorCohort,
  batchApproveRegistrations,
  rejectRegistration,
} from '../controllers/registrationController.js';

const router = Router();

// Student Registration State & Form Wizard
router.get('/current', getCurrentRegistrationState);
router.get('/eligible', getCurrentRegistrationState); // Backward compatibility alias
router.put('/draft', saveRegistrationDraft);
router.post('/submit', submitRegistration);

// Level Advisor & Department Clearance Routes
const requireAdvisorGovernance = requireRole([
  'LEVEL_ADVISOR',
  'HOD',
  'DEAN',
  'SENATE_OFFICER',
  'ADMIN',
  'SYSTEM_ADMIN',
  'ADVISOR',
  'STAFF',
]);

router.get('/advisor/cohort', requireAdvisorGovernance, getAdvisorCohort);
router.post('/advisor/batch-approve', requireAdvisorGovernance, batchApproveRegistrations);
router.post('/advisor/reject', requireAdvisorGovernance, rejectRegistration);

export default router;
