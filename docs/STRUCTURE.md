# Backend repository structure

```text
src/
  app/            Express app factory and middleware registration
  config/         Environment validation and logger
  controllers/    HTTP adapters only
  lib/            Errors, pagination, IDs, time, transaction helper
  middleware/     Request IDs, validation and error handling
  models/         Mongoose models (added in BE-2)
  routes/         Versioned route registration
  scripts/        Operational and seed scripts
  server/         Future server lifecycle helpers
  services/       Database connection and business services
  shared/schemas/ Pure shared Zod schemas (added in BE-2)
  tests/          Unit and replica-set integration tests
```

Request flow is routes → controllers → services → models. Controllers do not implement business rules. All production endpoints are under `/api/v1`; health endpoints are the only production endpoints in BE-1.
