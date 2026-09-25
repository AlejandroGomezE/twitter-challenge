#!/bin/sh
# Container entrypoint: apply the Prisma schema to the SQLite file at
# $DATABASE_URL, then run the API.
#
# `prisma db push` is idempotent (no-op when already in sync) and is how this
# project applies its schema (there are no migrations). It is intentionally
# run without --force-reset / --accept-data-loss: if a schema change would
# drop data, the push fails, the container exits non-zero and nothing is lost.
set -eu

cd /app
# Prisma 7's db push doesn't run generate (and rejects --skip-generate).
./node_modules/.bin/prisma db push

# Not `exec node`: as PID 1, node would ignore SIGTERM (the app installs no
# handler), so `docker stop` would hang until the SIGKILL timeout. Instead
# this shell stays PID 1 and forwards TERM/INT to node, which then exits.
node dist/main &
child=$!
trap 'kill -TERM "$child" 2>/dev/null || true' TERM INT
set +e
wait "$child"
status=$?
# A trapped signal interrupts `wait` early; wait again for node's real exit.
if kill -0 "$child" 2>/dev/null; then
  wait "$child"
  status=$?
fi
exit "$status"
