import 'dotenv/config';
import mongoose from 'mongoose';
import { Course } from '../src/models/Course';

const uri = process.env.MONGODB_URI_TEST;
if (!uri) throw new Error('Set MONGODB_URI_TEST in the local environment for this disposable public-registration fixture.');
const requestedDb = process.env.MONGODB_TEST_DB || 'passion_test';
if (!requestedDb.endsWith('_test')) throw new Error('Refusing to seed a database whose name does not end in _test.');
const slug = 'be5a-http-registration-example';

async function main() {
  await mongoose.connect(uri!, { dbName: requestedDb, serverSelectionTimeoutMS: 10_000 });
  const snapshot = {
    details: {
      title: { ar: 'كورس تجريبي للتسجيل' },
      pricing: { price: 12_000, promo: 9_500, currency: 'EGP' },
      enrollment: { registrationOpen: true, capacity: 100 },
    },
    page: { schemaVersion: 1, sections: [] },
    form: { fields: [
      { id: 'goal', type: 'text', label: { ar: 'إيه هدفك من الكورس؟' }, required: true, maxLength: 240 },
      { id: 'track', type: 'select', label: { ar: 'اختار المسار' }, required: true, options: [{ value: 'design', label: { ar: 'التصميم' } }, { value: 'business', label: { ar: 'إدارة الأعمال' } }] },
    ] },
    seo: {},
  };
  const prior = await Course.findOne({ slug }).setOptions({ strictQuery: false });
  if (prior) await Course.deleteOne({ _id: prior._id });
  await Course.create({ slug, status: 'published', createdBy: new mongoose.Types.ObjectId(), published: snapshot, draft: snapshot });
  process.stdout.write(`Published disposable registration fixture created in ${requestedDb}: ${slug}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Fixture seed failed: ${error instanceof Error ? error.constructor.name : 'UnknownError'}\n`);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});
