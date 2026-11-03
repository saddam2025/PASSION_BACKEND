import { Router } from 'express';
import { once } from 'node:events';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import {
  assignBodySchema, cancelBodySchema, confirmBodySchema, enrollmentIdParamsSchema,
  enrollmentExportGetQuerySchema, enrollmentListQuerySchema, followUpBodySchema, listNotesQuerySchema, noteBodySchema, recordPaymentBodySchema,
} from '../shared/schemas/staffRecords';
import { staffRecordsService } from '../services/staffRecordsService';
import { paymentsService } from '../services/paymentsService';
import { auditEnrollmentExport, prepareEnrollmentExport } from '../services/enrollmentExportService';
import { cairoCsvDate, csvAmountFromMinor, csvLine } from '../lib/csv';
import { MediaService } from '../services/mediaService';
import { createStorageDriver } from '../services/storageDriver';

export function enrollmentsRouter(environment: AppEnvironment, logger: pino.Logger) {
  const router = Router();
  const mediaService = new MediaService(createStorageDriver(environment), logger, environment.RECEIPT_SIGNED_URL_SECONDS);
  router.use(requireAuth(environment));

  router.get('/filters', requirePermission('viewLeads'), asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.enrollmentFilters(request.auth!));
  }));

  router.get('/', requirePermission('viewLeads'), validateRequest({ query: enrollmentListQuerySchema }), asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.listEnrollments(request.query as never, request.auth!));
  }));

  const exportCsv = asyncHandler(async (request, response) => {
    const query = (request.method === 'POST' ? request.body : request.query) as never;
    const exported = await prepareEnrollmentExport(query, request.auth!);
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
    const filename = `registrations-${parts.year}${parts.month}${parts.day}.csv`;
    const headers = ['رقم التسجيل', 'الاسم', 'البريد الإلكتروني', 'رقم الهاتف', 'الكورس', 'حالة التسجيل', 'حالة المتابعة', 'المسؤول', 'تاريخ التسجيل'];
    if (exported.includePayments) headers.push('حالة الدفع', 'صافي المدفوع', 'المتبقي');
    response.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    let rowCount = 0;
    const write = async (chunk: string) => { if (!response.write(chunk)) await once(response, 'drain'); };
    try {
      await write(`\uFEFF${csvLine(headers)}`);
      for await (const row of exported.cursor) {
        const values: unknown[] = [row.reference, row.lead.fullName, row.lead.email, row.lead.phone, row.courseTitle, row.enrollmentStatus, row.followUpStatus, row.assignedTo, cairoCsvDate(row.registeredAt)];
        if (exported.includePayments) {
          const netMinor = row.paymentSummary?.netMinor ?? 0;
          const currency = row.priceSnapshot.currency;
          values.push(row.paymentSummary?.status ?? 'unpaid', csvAmountFromMinor(netMinor, currency), row.priceSnapshot.amount === null ? '' : csvAmountFromMinor(Math.max(row.priceSnapshot.amount - netMinor, 0), currency));
        }
        await write(csvLine(values));
        rowCount += 1;
      }
      await auditEnrollmentExport(query, rowCount, request.auth!, logger);
      response.end();
    } catch (error) {
      if (!response.headersSent) throw error;
      response.destroy(error instanceof Error ? error : new Error('CSV stream failed'));
    } finally {
      await exported.cursor.close();
    }
  });
  router.get('/export.csv', requireRole('admin'), validateRequest({ query: enrollmentExportGetQuerySchema }), exportCsv);
  router.post('/export.csv', ...csrfProtection(environment), requireRole('admin'), validateRequest({ body: enrollmentListQuerySchema }), exportCsv);

  router.post('/:id/payments', ...csrfProtection(environment), requirePermission('recordPayments'), validateRequest({ params: enrollmentIdParamsSchema, body: recordPaymentBodySchema }), asyncHandler(async (request, response) => {
    const result = await paymentsService.record(String(request.params.id), request.body, request.auth!, logger, mediaService);
    response.status(result.replayed ? 200 : 201).json(result);
  }));

  router.get('/:id/payments', requirePermission('viewPayments'), validateRequest({ params: enrollmentIdParamsSchema }), asyncHandler(async (request, response) => {
    response.json(await paymentsService.listForEnrollment(String(request.params.id), request.auth!));
  }));

  router.get('/:id/notes', requirePermission('manageNotes'), validateRequest({ params: enrollmentIdParamsSchema, query: listNotesQuerySchema }), asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.listNotes(String(request.params.id), request.query as never));
  }));

  router.post('/:id/notes', ...csrfProtection(environment), requirePermission('manageNotes'), validateRequest({ params: enrollmentIdParamsSchema, body: noteBodySchema }), asyncHandler(async (request, response) => {
    response.status(201).json({ note: await staffRecordsService.addNote(String(request.params.id), request.auth!, request.body, logger) });
  }));

  router.patch('/:id/follow-up', ...csrfProtection(environment), requirePermission('updateFollowUp'), validateRequest({ params: enrollmentIdParamsSchema, body: followUpBodySchema }), asyncHandler(async (request, response) => {
    response.json({ enrollment: await staffRecordsService.updateFollowUp(String(request.params.id), request.auth!, request.body, logger) });
  }));

  router.post('/:id/assign', ...csrfProtection(environment), requireRole('admin'), validateRequest({ params: enrollmentIdParamsSchema, body: assignBodySchema }), asyncHandler(async (request, response) => {
    response.json({ enrollment: await staffRecordsService.assign(String(request.params.id), request.auth!, request.body.assigneeId, logger) });
  }));

  router.post('/:id/confirm', ...csrfProtection(environment), requireRole('admin'), validateRequest({ params: enrollmentIdParamsSchema, body: confirmBodySchema }), asyncHandler(async (request, response) => {
    response.json({ enrollment: await staffRecordsService.confirm(String(request.params.id), request.auth!, request.body.reason, logger) });
  }));

  router.post('/:id/cancel', ...csrfProtection(environment), requireRole('admin'), validateRequest({ params: enrollmentIdParamsSchema, body: cancelBodySchema }), asyncHandler(async (request, response) => {
    response.json({ enrollment: await staffRecordsService.cancel(String(request.params.id), request.auth!, request.body.reason, logger) });
  }));

  router.post('/:id/whatsapp-contact', ...csrfProtection(environment), requirePermission('updateFollowUp'), validateRequest({ params: enrollmentIdParamsSchema }), asyncHandler(async (request, response) => {
    response.json({ enrollment: await staffRecordsService.logWhatsappContact(String(request.params.id), request.auth!, logger) });
  }));

  router.get('/:id', requirePermission('viewLeads'), validateRequest({ params: enrollmentIdParamsSchema }), asyncHandler(async (request, response) => {
    response.json({ enrollment: await staffRecordsService.getEnrollment(String(request.params.id)) });
  }));

  return router;
}
