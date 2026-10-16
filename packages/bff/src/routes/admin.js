/**
 * FOCIT LMS - Administrator Router
 *
 * All endpoints in this router are guarded by the RBAC barrier
 * requiring role ADMIN or SYSTEM_ADMIN.
 */

import express from 'express';
import { requireRole } from '../middleware/auth.js';
import * as adminController from '../controllers/adminController.js';

const router = express.Router();

// Enforce ADMIN role barrier for all routes in this router
router.use(requireRole(['ADMIN', 'SYSTEM_ADMIN']));

// 1. Overview & Health
router.get('/dashboard', adminController.getDashboardOverview);

// 2. User Governance & Provisioning
router.get('/users', adminController.listUsers);
router.post('/users', adminController.createUser);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.patch('/users/:id/role', adminController.updateUserRole);

// 3. Moodle Integration & Outbox Monitoring
router.get('/integrations/moodle', adminController.getMoodleHealth);
router.get('/integrations/outbox', adminController.getOutboxEvents);
router.post('/integrations/outbox/:id/retry', adminController.retryOutboxEvent);

// 4. Security & Identity Audit Ledger
router.get('/audit-logs', adminController.getAuditLogs);

// 5. Academic Governance & Registration Windows
router.get('/academic-semesters', adminController.getAcademicSemesters);
router.patch('/academic-semesters/:id/registration-window', adminController.toggleRegistrationWindow);

export default router;
