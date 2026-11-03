/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Settings } from '../models/Settings';
import { Category } from '../models/Category';
import { AuditLog } from '../models/AuditLog';
import { Course } from '../models/Course';
import { User } from '../models/User';
import { Invite } from '../models/Invite';
import { readSettings, publicSettings, patchSettings } from '../services/settingsApiService';
import { categoriesService, categorySlug } from '../services/categoriesApiService';
import { listAudit, exportAudit } from '../services/auditQueryService';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';
import { createLogger } from '../config/logger';
import { parseEnvironment } from '../config/env';
import { createApp } from '../app/createApp';
import { createAccessToken } from '../services/authTokens';
import { authService } from '../services/authService';
import { createOpaqueToken, hashOpaqueToken, effectivePermissions } from '../services/authTokens';
import { settingsSectionSchema } from '../shared/schemas/settingsApi';
import request from 'supertest';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
if (!uri) throw new Error('BE-7A focused integration tests require MONGODB_URI_TEST; a skipped DB test is not a pass.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-7A focused integration tests require NODE_ENV=test.');
const logger = createLogger('silent');
const environment = parseEnvironment({ NODE_ENV:'test',PORT:'4000',MONGODB_URI:uri!,ACCESS_TOKEN_SECRET:'be7a-test-access-secret-long-enough-0001',REFRESH_TOKEN_SECRET:'be7a-test-refresh-secret-long-enough-0002',COOKIE_DOMAIN:'localhost',COOKIE_SECURE:'false',CORS_ORIGINS:'http://localhost:5173',APP_BASE_URL:'http://localhost:5173',LOG_LEVEL:'silent' });
const app = createApp(environment,{logger,rateLimitMax:500});
const owned = [Settings, Category, AuditLog, Course, User, Invite].map((model) => model.collection.name);
const actorId = new mongoose.Types.ObjectId();
const fakeMedia = { addUsage: async () => {}, removeUsage: async () => {} } as any;

beforeAll(async () => { await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 }); await clearNamedCollections(mongoose.connection, owned); await User.create({ _id: actorId, email:'be7a@example.test',name:'مسؤول الإعدادات',role:'admin',passwordHash:'hash-value-which-is-long-enough',permissions:{},isActive:true }); },60_000);
afterAll(async () => { await clearNamedCollections(mongoose.connection, owned); await mongoose.disconnect(); },30_000);

describe('BE-7A settings, categories, audit', () => {
 it('public settings expose only the validated registration template and never private settings', async () => { const settings=await readSettings(); settings.messageTemplates=new Map([['registration','أهلًا {name} عن {course} ({reference})'],['admin-secret','secret template']]); settings.staffDefaultPermissions=['viewLeads'] as any; await settings.save(); const result=publicSettings(settings as any); expect(result.whatsappMessageTemplate).toContain('{reference}'); expect(result).not.toHaveProperty('messageTemplates'); expect(result).not.toHaveProperty('staffDefaultPermissions'); expect(JSON.stringify(result)).not.toContain('secret template'); });
 it('validates URL schemes, message placeholders, currency relationships and permission keys per section', () => { expect(settingsSectionSchema.safeParse({section:'contact',value:{mapLink:'javascript:alert(1)'}}).success).toBe(false); expect(settingsSectionSchema.safeParse({section:'messaging',value:{welcome:'مرحبًا {password}'}}).success).toBe(false); expect(settingsSectionSchema.safeParse({section:'payments',value:{defaultCurrency:'EGP',enabledCurrencies:['USD']}}).success).toBe(false); expect(settingsSectionSchema.safeParse({section:'permissions',value:{defaultPermissions:['superAdmin']}}).success).toBe(false); });
 it('patches settings by section and rejects stale versions', async () => { const current=await readSettings(); const result=await patchSettings({expectedVersion:current.version,section:'academy',value:{name:{ar:'أكاديمية الاختبار'}}},String(actorId),fakeMedia,logger); expect(result.academy.name).toBe('أكاديمية الاختبار'); await expect(patchSettings({expectedVersion:current.version,section:'academy',value:{name:{ar:'قديم'}}},String(actorId),fakeMedia,logger)).rejects.toMatchObject({statusCode:409,details:{currentVersion:expect.any(Number)}}); });
 it('sanitizes legal HTML and increments policyVersion only when legal text changes', async () => { let current=await readSettings(); const page={privacyPolicy:{title:{ar:'الخصوصية'},body:{ar:'<p>نص آمن</p><script>alert(1)</script>'}}}; let saved=await patchSettings({expectedVersion:current.version,section:'legal',value:page},String(actorId),fakeMedia,logger); expect(saved.legal.privacyPolicy?.body).toBe('<p>نص آمن</p>'); const version=saved.legal.privacyPolicy?.policyVersion; current=await readSettings(); saved=await patchSettings({expectedVersion:current.version,section:'legal',value:page},String(actorId),fakeMedia,logger); expect(saved.legal.privacyPolicy?.policyVersion).toBe(version); });
 it('generates a deterministic Arabic category slug, soft-deletes and keeps hidden categories out of public list', async () => { expect(categorySlug('كورسات البرمجة')).toMatch(/^k/); const item=await categoriesService.create('تصنيف تجريبي',undefined,String(actorId),logger); expect(item.slug).toBe(categorySlug('تصنيف تجريبي')); await categoriesService.remove(item.id,String(actorId),logger); expect((await categoriesService.list()).some((row)=>row.id===item.id)).toBe(false); });
 it('refuses deleting a category in use by a course with a typed conflict', async () => { const item=await categoriesService.create('تصنيف مستخدم',undefined,String(actorId),logger); await Course.create({slug:`be7a-${Date.now()}`,status:'draft',featured:false,createdBy:actorId,version:0,draft:{details:{category:item.name},page:{schemaVersion:1,sections:[]},form:{fields:[]}}}); await expect(categoriesService.remove(item.id,String(actorId),logger)).rejects.toMatchObject({statusCode:409,details:{usageCount:1}}); });
 it('queries audit entries with Cairo day boundaries, capped pagination and safe actor projection', async () => { await AuditLog.create({actorId,action:'settings_updated',entityType:'settings',entityId:actorId,note:'updated section',occurredAt:new Date('2026-10-31T20:59:59.000Z')}); const result=await listAudit({dateFrom:'2026-10-31',dateTo:'2026-10-31',page:1,pageSize:1}); expect(result.total).toBe(1); expect(result.items[0]?.actor).toEqual({id:String(actorId),name:'مسؤول الإعدادات'}); expect(result.items[0]).not.toHaveProperty('email'); });
 it('exports UTF-8 BOM and neutralizes formula injection without exposing ids', async () => { await AuditLog.create({actorId,action:'=cmd',entityType:'test',entityId:actorId,occurredAt:new Date()}); const result=await exportAudit({}); expect(result.csv.charCodeAt(0)).toBe(0xfeff); expect(result.csv).toContain("'=cmd"); expect(result.csv).not.toContain(String(actorId)); expect(result.csv).not.toContain('tokenHash'); });
 it('serves public settings and categories and gates the audit endpoint through real HTTP requests', async () => { const user=await User.findById(actorId); const token=createAccessToken(user!,environment); const publicResponse=await request(app).get('/api/v1/settings/public').expect(200); expect(publicResponse.headers['cache-control']).toContain('max-age=300'); expect(publicResponse.body).not.toHaveProperty('messageTemplates'); await request(app).get('/api/v1/categories/public').expect(200); const audit=await request(app).get('/api/v1/audit').set('Cookie',`passion_access=${token}`).expect(200); expect(audit.body.items[0].actor).toEqual({id:String(actorId),name:'مسؤول الإعدادات'}); });
 it('applies an Admin settings section through the authenticated HTTP route with CSRF and optimistic version', async () => { const user=await User.findById(actorId); const token=createAccessToken(user!,environment); const current=await readSettings(); const csrf='be7a-csrf-token'; const response=await request(app).patch('/api/v1/settings').set('Origin','http://localhost:5173').set('X-CSRF-Token',csrf).set('Cookie',`passion_access=${token}; passion_csrf=${csrf}`).send({expectedVersion:current.version,section:'academy',value:{name:{ar:'أكاديمية عبر الواجهة'}}}).expect(200); expect(response.body.academy.name).toBe('أكاديمية عبر الواجهة'); });
 it('stores invitation grants for compatibility without widening the fixed Assistant rights', async () => { const settings=await readSettings(); settings.staffDefaultPermissions=['viewSettings','exportCsv'] as any; await settings.save(); const before=await User.findById(actorId); const raw=createOpaqueToken(); await Invite.create({tokenHash:hashOpaqueToken(raw),email:'be7a-invited@example.test',role:'assistant',permissions:['viewFinancialReports'],invitedBy:actorId,expiresAt:new Date(Date.now()+60_000),purgeAt:new Date(Date.now()+31*24*60*60_000)}); await authService.acceptInvite(raw,'مساعد الاختبار','Strong-Passphrase-97!x',logger); const invited=await User.findOne({email:'be7a-invited@example.test'}); expect(invited?.settingsPermissionsApplied).toBe(true); expect(effectivePermissions(invited!)).toEqual(expect.arrayContaining(['viewLeads','viewPayments','recordPayments'])); expect(effectivePermissions(invited!)).not.toContain('viewSettings'); expect(effectivePermissions(invited!)).not.toContain('exportCsv'); expect(effectivePermissions(invited!)).not.toContain('viewFinancialReports'); const existing=await User.findById(actorId); expect(existing?.permissions).toEqual(before?.permissions); });
});
