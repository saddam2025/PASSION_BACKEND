# Shared schema sync

Run `npm run check:schema-sync` after changing shared validation. The script compares frontend sources and backend copies after normalizing line endings and the course schema's alias-to-relative import rewrite. Set `FRONTEND_SCHEMAS_PATH` if the frontend checkout is elsewhere. A missing source or any drift fails the check.

BE-4 copies the frontend pure-Zod course contract: `course.ts`, `courseDraft.ts`, `registrationForm.ts`, and every `sections/*.ts` module (currently 15 section modules). Course page sections are stored as Mixed values in MongoDB but validated against these schemas on course create, draft save, and publish. `courseReadiness.ts` is copied as a service helper, not part of the byte-sync manifest: its development-only `import.meta` logging is removed for Node, and its diagnostics are mapped to API validation errors. `coursesApi.ts` is backend-owned HTTP request validation.

Other backend-owned schemas are not synchronized unless the frontend has the same standalone stable source file. The current frontend does not expose standalone `user.ts`, `enrollment.ts`, or `category.ts`; enrollment is still part of its lead schema. Do not add React, browser, or frontend-service imports to backend validation modules.

Persistence intentionally narrows some frontend types. Payment records stored in Mongo are only `confirmed` or `voided`; enrollment payment status is derived. Backend `Enrollment.assignedTo` maps the frontend `assignedToUserId`; consent and course data are snapshots. These differences belong at the service mapping boundary and must not weaken persistence invariants.

Shared schemas validate input shapes; services explicitly allowlist values and construct model updates rather than mass-assigning request bodies.
