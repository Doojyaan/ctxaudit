# Project Rules

You are a senior engineer working on a payments platform.

## Architecture

The system is a monorepo with four services: `api`, `worker`, `web`, and
`shared`. Services communicate over an internal event bus. The bus is
at-least-once, so every consumer must be idempotent. The `shared` package
holds types and must never import from any service.

## Conventions

- TypeScript strict mode everywhere.
- Never use `any`. If you think you need `any`, you need a type guard.
- All new API endpoints need an OpenAPI entry.
- All database migrations must be reversible.
- Use the repository pattern; never call the ORM from a route handler.
- Errors are returned as `Result<T, E>`, never thrown across module boundaries.
- Log with the structured logger, never `console.log`.
- Tests live next to the file they test, named `*.test.ts`.
- Prefer named exports.
- Never commit secrets; use the config service.

## Review checklist

1. Does the change have a test that fails without it?
2. Are all new branches covered?
3. Is there an index for every new query pattern?
4. Are all user-facing strings translated?
5. Is the migration reversible?
6. Does the change touch the payment path? If yes, request a second review.
7. Are feature flags used for anything user-visible?
8. Is there a rollback plan in the PR description?
9. Are logs structured and free of PII?
10. Are timeouts set on every outbound call?

## Historical context

This section exists because people kept asking the same questions in review.
In 2024 we had an incident where a retry loop caused duplicate charges. Since
then every consumer must be idempotent. The `worker` service was split out of
`api` in 2025 to isolate long-running jobs. The `web` service is Next.js and
was migrated from CRA in 2025. The `shared` package was extracted in 2026.

## Common tasks

- To add an endpoint: define the OpenAPI spec, generate the client, write the
  handler, write the test, update the docs.
- To add a migration: write it, test it forward, test it backward, deploy it
  separately from the code that depends on it.
- To add a queue consumer: make it idempotent, add a dead-letter handler, add
  a metric, add an alert on the dead-letter queue depth.
- To add a cron job: use the scheduler, make it idempotent, add a lock, add a
  timeout, add an alert on consecutive failures.
- To debug a payment issue: check the event log, check the idempotency key,
  check the provider dashboard, check the reconciliation report.

## Things that have bitten us

- Assuming the event bus delivers once. It does not.
- Assuming a webhook arrives before the user refreshes. It does not.
- Assuming the provider's sandbox matches production. It does not.
- Assuming a retry is free. It is not.
- Assuming a migration can be rolled back after data has been written. It can
  not, unless you wrote the down migration carefully.
