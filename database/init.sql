-- Initial setup script for local PostgreSQL
-- This runs automatically when Docker container starts

\c telemetry;

-- Run main schema
\i /docker-entrypoint-initdb.d/schema.sql
