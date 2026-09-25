# twitter-challenge

## Description
Technical Challenge — Twitter Clone **The Flock · Managed Software Teams**

Run the whole stack with Docker: `docker compose up --build` from the repo root. See
[Runbook → Run with Docker](../Runbook.md#run-with-docker). For local development (hot reload),
see [Runbook.md](../Runbook.md).

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Seed demo data

```bash
# reset the database to the demo data set (wipes every user, post, like, follow,
# comment, notification and session first); needs `npx prisma db push` beforehand
$ npm run db:seed

# seed only if the database has no users (what Docker runs on start)
$ npm run db:seed -- --if-empty

# same as `npm run db:seed`, through Prisma
$ npx prisma db seed
```

Demo account: `demo@example.com` / `password1234`. Every seed user's password is `password1234`.
What it creates and more sample credentials:
[Runbook → Backend → Seed data](../Runbook.md#backend-backend).

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.