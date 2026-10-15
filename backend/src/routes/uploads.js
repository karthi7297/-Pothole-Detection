import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DAMAGE_CLASSES } from '../config.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { IngestError, ingestDetection } from '../services/ingest.js';
import { gradeOf } from '../services/priority.js';
import { analyzeUpload, manualLabelConfidence } from '../services/vision.js';

const router = Router();

const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(here, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'upload';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — one photo or short clip
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image/* or video/* files are accepted.'));
  },
});

/**
 * Schema for anonymous citizen uploads — no vehicle_id, lighter validation.
 */
const anonMetaSchema = z.object({
  latitude: z.coerce.number().gte(-90).lte(90),
  longitude: z.coerce.number().gte(-180).lte(180),
  location_name: z.string().trim().max(140).optional(),
  location_mode: z.enum(['gps', 'manual']).optional().default('manual'),
  damage_class: z.enum([...DAMAGE_CLASSES, 'auto']).optional().default('auto'),
  confidence: z.coerce.number().gte(0).lte(1).optional(),
  bbox_area_ratio: z.coerce.number().gt(0).lte(0.6).optional(),
});

/**
 * Turn the uploaded frame plus whatever the reporter told us into the record the
 * ingest pipeline consumes. `services/vision.js` measures the damage signature
 * in the decoded pixels, so confidence and severity reflect the actual photo
 * rather than a hard-coded constant.
 *
 *   damage_class = 'auto'  → the pixels decide the class, the confidence and the
 *                            bounding-box ratio (PRD 4.2 severity input).
 *   explicit class         → the reporter's label is honoured, but confidence is
 *                            still evidence-weighted: a clear matching frame
 *                            auto-verifies, a vague one is held as Pending.
 *
 * An explicit `confidence` / `bbox_area_ratio` from the client still wins, so
 * field devices can override the classifier.
 */
async function resolveDetection(file, meta) {
  const vision = await analyzeUpload(file.path, { mimetype: file.mimetype, size: file.size });

  if (meta.damage_class === 'auto') {
    return {
      damage_class: vision.damage_class,
      confidence: meta.confidence ?? vision.confidence,
      bbox_area_ratio: meta.bbox_area_ratio ?? vision.bbox_area_ratio,
      detector: vision.detector,
      vision,
    };
  }

  return {
    damage_class: meta.damage_class,
    confidence: meta.confidence ?? manualLabelConfidence(vision.class_scores, meta.damage_class),
    bbox_area_ratio: meta.bbox_area_ratio ?? vision.bbox_area_ratio,
    detector: vision.decoded ? `${vision.detector}+manual-label` : 'manual-label',
    vision,
  };
}

/** Public shape of the detector verdict returned to the client. */
function detectionPayload(detected, result) {
  return {
    damage_class: detected.damage_class,
    confidence: detected.confidence,
    bbox_area_ratio: detected.bbox_area_ratio,
    detector: detected.detector,
    decoded: detected.vision.decoded,
    below_gate: result.below_gate === true,
    class_scores: detected.vision.class_scores,
    grade: gradeOf(result.hotspot?.priority_score ?? 0),
  };
}

/**
 * Anonymous citizen upload path: multipart/form-data with:
 *   file (image|video, required), latitude, longitude,
 *   location_mode=gps|manual, damage_class=pothole|alligator_crack|longitudinal_crack|auto,
 *   confidence?, bbox_area_ratio?
 * Persists the detection with source='manual-citizen', no vehicle_id,
 * no dedup/hotspot clustering on first write (can be linked later).
 */
router.post(
  '/detections/upload-anonymous',
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return next(httpError(400, 'A photo or video file is required (field "file").', 'FILE_REQUIRED'));

      const parsed = anonMetaSchema.safeParse(req.body);
      if (!parsed.success) {
        fs.unlink(req.file.path, () => {});
        return next(httpError(400, 'Location/severity fields failed validation.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));
      }
      const meta = parsed.data;
      const detected = await resolveDetection(req.file, meta);

      const imageUrl = `/uploads/${req.file.filename}`;
      const vehicleId = `CIT-${Date.now()}`; // anonymous citizen id

      let result;
      try {
        result = ingestDetection(
          {
            vehicle_id: vehicleId,
            latitude: meta.latitude,
            longitude: meta.longitude,
            location_name: meta.location_name || null,
            damage_class: detected.damage_class,
            confidence: detected.confidence,
            bbox_area_ratio: detected.bbox_area_ratio,
            image_url: imageUrl,
            source: 'manual-citizen',
          },
          // No user context; a citizen report is held for an officer when the
          // detector cannot confirm it, never silently discarded.
          { user: null, holdBelowGate: true }
        );
      } catch (err) {
        if (err instanceof IngestError) {
          return next(httpError(err.status, err.message, err.code, err.details));
        }
        // If it's a non-ingest error (e.g. DB issue), still try to respond.
        throw err;
      }

      audit({
        userId: null,
        userEmail: 'citizen-anonymous',
        action: 'detection.upload.anonymous',
        entity: 'detection',
        entityId: result.detection_id ?? null,
        detail: `${req.file.originalname} (${req.file.mimetype}, ${(req.file.size / 1024).toFixed(0)}KB) via ${meta.location_mode} @ ${meta.latitude},${meta.longitude} -> ${detected.damage_class} (citizen report)`,
      });

      res.status(201).json({
        ...result,
        file: {
          name: req.file.originalname,
          storedAs: req.file.filename,
          url: imageUrl,
          mimetype: req.file.mimetype,
          sizeBytes: req.file.size,
        },
        location: { latitude: meta.latitude, longitude: meta.longitude, mode: meta.location_mode, name: result.location_name || null },
        detection: detectionPayload(detected, result),
        anonymous: true,
      });
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {});
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(httpError(413, 'File too large — 25 MB max.', 'FILE_TOO_LARGE'));
      }
      next(err);
    }
  }
);

/**
 * Authenticated driver/field upload path (same as before):
 * multipart/form-data with file + metadata, runs full ingest pipeline,
 * dedup, hotspot clustering, PCI recompute, broadcast, audit.
 */
router.post(
  '/detections/upload',
  requireAuth,
  requireCapability('detections:ingest'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return next(httpError(400, 'A photo or video file is required (field "file").', 'FILE_REQUIRED'));

      const metaSchema = z.object({
        latitude: z.coerce.number().gte(-90).lte(90),
        longitude: z.coerce.number().gte(-180).lte(180),
        location_name: z.string().trim().max(140).optional(),
        location_mode: z.enum(['gps', 'manual']).optional().default('manual'),
        damage_class: z.enum([...DAMAGE_CLASSES, 'auto']).optional().default('auto'),
        confidence: z.coerce.number().gte(0).lte(1).optional(),
        vehicle_id: z.string().trim().min(2).max(60).optional(),
        bbox_area_ratio: z.coerce.number().gt(0).lte(0.6).optional(),
      });

      const parsed = metaSchema.safeParse(req.body);
      if (!parsed.success) {
        fs.unlink(req.file.path, () => {});
        return next(httpError(400, 'Location/severity fields failed validation.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));
      }
      const meta = parsed.data;
      const detected = await resolveDetection(req.file, meta);

      // Stable reporter id so a signed-in user can track every report they filed.
      const vehicleId = meta.vehicle_id || `CITIZEN-${req.user.id}`;
      const imageUrl = `/uploads/${req.file.filename}`;

      let result;
      try {
        result = ingestDetection(
          {
            vehicle_id: vehicleId,
            latitude: meta.latitude,
            longitude: meta.longitude,
            location_name: meta.location_name || null,
            damage_class: detected.damage_class,
            confidence: detected.confidence,
            bbox_area_ratio: detected.bbox_area_ratio,
            image_url: imageUrl,
            source: 'manual',
          },
          { user: req.user, holdBelowGate: true }
        );
      } catch (err) {
        if (err instanceof IngestError) {
          return next(httpError(err.status, err.message, err.code, err.details));
        }
        throw err;
      }

      audit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'detection.upload',
        entity: 'detection',
        entityId: result.detection_id ?? null,
        detail: `${req.file.originalname} (${req.file.mimetype}, ${(req.file.size / 1024).toFixed(0)}KB) via ${meta.location_mode} @ ${meta.latitude},${meta.longitude} -> ${detected.damage_class}`,
      });

      res.status(201).json({
        ...result,
        file: {
          name: req.file.originalname,
          storedAs: req.file.filename,
          url: imageUrl,
          mimetype: req.file.mimetype,
          sizeBytes: req.file.size,
        },
        location: { latitude: meta.latitude, longitude: meta.longitude, mode: meta.location_mode, name: result.location_name || null },
        detection: detectionPayload(detected, result),
      });
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {});
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(httpError(413, 'File too large — 25 MB max.', 'FILE_TOO_LARGE'));
      }
      next(err);
    }
  }
);

export default router;