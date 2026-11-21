/**
 * FOCIT LMS - Digital Library Administrative & Curation Routes
 * Endpoint Prefix: /api/library/admin
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { perUserRateLimit } from '../middleware/rateLimiter.js';
import {
  handleStreamUpload,
  commitLibraryItem,
  updateLibraryItem,
  softDeleteLibraryItem,
  hardPurgeLibraryItem,
  listAdminLibraryItems,
  getLibraryAdminStats,
} from '../services/libraryAdminService.js';
import { runLibraryReaperSweep } from '../workers/libraryReaperWorker.js';

const router = Router();

// Administrative Role Gate: DEAN, HOD, ADMIN, SYSTEM_ADMIN
const curationAuthGuard = requireRole(['DEAN', 'HOD', 'ADMIN', 'SYSTEM_ADMIN']);
const adminOnlyGuard = requireRole(['ADMIN', 'SYSTEM_ADMIN']);
const uploadLimiter = perUserRateLimit(30, 60_000, 'library_upload');

/**
 * Step 1: POST /api/library/admin/upload
 * Two-phase Busboy streaming valve with magic-byte sniff & CAS placement.
 */
router.post('/upload', curationAuthGuard, uploadLimiter, async (req, res, next) => {
  try {
    await handleStreamUpload(req, res);
  } catch (err) {
    next(err);
  }
});

/**
 * Step 2: POST /api/library/admin/items
 * Transactional metadata commit. Consumes verified staging ticket from Step 1.
 */
router.post('/items', curationAuthGuard, async (req, res, next) => {
  try {
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const item = await commitLibraryItem(req.user, req.body, clientIp);
    return res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/library/admin/items
 * Administrative library directory with filters (embargo status, drafts, category).
 */
router.get('/items', curationAuthGuard, async (req, res, next) => {
  try {
    const result = await listAdminLibraryItems(req.user, req.query);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/library/admin/stats
 * Curation metrics, quota breakdown, and item counts.
 */
router.get('/stats', curationAuthGuard, async (req, res, next) => {
  try {
    const stats = await getLibraryAdminStats(req.user);
    return res.json({ data: stats });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/library/admin/items/:id
 * Updates metadata, publication status, or embargo quarantine.
 */
router.patch('/items/:id', curationAuthGuard, async (req, res, next) => {
  try {
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const updated = await updateLibraryItem(req.user, req.params.id, req.body, clientIp);
    return res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/library/admin/items/:id
 * Default: Soft-delete (is_published = false)
 * With ?purge=true: Hard-purge (SYSTEM_ADMIN only, decrements CAS ref_count)
 */
router.delete('/items/:id', curationAuthGuard, async (req, res, next) => {
  try {
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const isPurge = req.query.purge === 'true' || req.query.purge === '1';

    if (isPurge) {
      const result = await hardPurgeLibraryItem(req.user, req.params.id, clientIp);
      return res.json({ data: result, message: 'Item permanently purged from catalog.' });
    }

    const updated = await softDeleteLibraryItem(req.user, req.params.id, clientIp);
    return res.json({ data: updated, message: 'Item unpublished and archived.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/library/admin/reaper/sweep
 * Triggers on-demand execution of the Orphan Reaper Worker.
 */
router.post('/reaper/sweep', adminOnlyGuard, async (req, res, next) => {
  try {
    const result = await runLibraryReaperSweep();
    return res.json({ data: result, message: 'Orphan reaper sweep executed successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;

