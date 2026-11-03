/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { auditQuerySchema } from '../shared/schemas/auditQuery';
import { listAudit, exportAudit } from '../services/auditQueryService';
import { writeAudit } from '../services/audit';
import type { AuthActor } from '../types/express';
export function auditApiRouter(environment: AppEnvironment, logger: pino.Logger) {
 const router=Router(); router.use(requireAuth(environment),requireRole('admin'));
 router.get('/export.csv',validateRequest({query:auditQuerySchema}),asyncHandler(async(req,res)=>{ const query=req.query as any; const result=await exportAudit(query); await writeAudit({actorId:(req.auth as AuthActor).id,action:'audit_exported',entityType:'audit_log',note:`count:${Math.min(result.total,10000)}`},logger); res.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition','attachment; filename="audit.csv"').send(result.csv); }));
 router.get('/',validateRequest({query:auditQuerySchema}),asyncHandler(async(req,res)=>res.json(await listAudit(req.query as any))));
 return router;
}
