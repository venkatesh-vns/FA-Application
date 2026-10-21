-- =====================================================================
--  FA Management System - database setup (run once per server)
--  Run as the PostgreSQL superuser (postgres) in pgAdmin > Query Tool or psql.
--  Then EITHER let the application create its tables at the first deployment
--  (deploy\deploy.bat), OR load database/schema.sql into fa_management.
-- =====================================================================

-- 1. The application's own login (not a superuser). Choose a strong password
--    and put the same values in the environment's config.env / .env.
CREATE ROLE fa_app LOGIN PASSWORD 'CHANGE-ME-strong-password';
ALTER ROLE fa_app CREATEDB;          -- lets the Staging/UAT refresh re-create its database

-- 2. Databases, owned by that login (so it can create tables, indexes and pg_trgm)
CREATE DATABASE fa_management         OWNER fa_app ENCODING 'UTF8';   -- Production
CREATE DATABASE fa_management_staging OWNER fa_app ENCODING 'UTF8';   -- Staging / UAT (copy of production)
CREATE DATABASE fa_management_archive OWNER fa_app ENCODING 'UTF8';   -- Year-End Archive

-- 3. Fast "contains" search (trusted extension; run in fa_management if the
--    application's login may not create it):
--    \c fa_management
--    CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 4. Database on a separate server: in postgresql.conf set listen_addresses = '*'
--    and in pg_hba.conf allow only the application server, e.g.
--    host  fa_management,fa_management_staging,fa_management_archive  fa_app  10.0.0.15/32  scram-sha-256
--    then restart PostgreSQL and open port 5432 for that address only.

-- 5. New, empty database: after the tables exist create the first Admin
--    (admin / admin123 - change it at the first sign-in):
--    cd <app>\server  and  node scripts\seedAdmin.js
