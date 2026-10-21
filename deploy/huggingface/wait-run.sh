#!/bin/sh
# Waits for Postgres and Redis, makes sure the database exists, then runs the given command.
until pg_isready -q -h 127.0.0.1 -U saw; do sleep 1; done
createdb -h 127.0.0.1 -U saw saw 2>/dev/null || true
until redis-cli -h 127.0.0.1 ping >/dev/null 2>&1; do sleep 1; done
exec "$@"
