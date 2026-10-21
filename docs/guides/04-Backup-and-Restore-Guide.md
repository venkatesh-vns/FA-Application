# 4. Backup & Restore Guide

All backups are standard PostgreSQL backups: **pgAdmin**, `pg_restore` and every cloud PostgreSQL service can restore them. Backups contain all data, including user names and password hashes: store them on protected storage only.

## 4.1 Backups that happen automatically

| When | File (in `<environment>\backups\`) | By |
| --- | --- | --- |
| Before every deployment | `fa_management_before_deploy_<version>_<time>.backup` | `deploy\deploy.bat` |
| Before a Year-End Archive / restore | `fa_management_before_archive_<period>_<time>.backup` | Administration › Year-End Archive |
| Every night 01:30 (once installed) | `fa_management_nightly_<time>.backup` (last 30 days kept) | `deploy\backup-nightly.ps1` |

Install the nightly backup once (PowerShell as Administrator):
```
powershell -ExecutionPolicy Bypass -File deploy\backup-nightly.ps1 -Env production -Install
```
Copy the backup folder to another disk / server or the company backup system every day (e.g. Windows Server Backup, robocopy to a NAS). A backup that only exists on the same server does not protect against a disk failure.

## 4.2 Back up by hand

**pgAdmin:** right-click the database `fa_management` › **Backup…** › Format **Custom** › Filename `D:\FA\backups\fa_management_<date>.backup` › **Backup**. (Do the same for `fa_management_archive` if Year-End Archive is used.)

**Command line** (on any PC with the PostgreSQL tools):
```
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h <db-server> -U fa_app -Fc -f D:\FA\backups\fa_management_<date>.backup fa_management
```
A plain-SQL copy (readable in any SQL tool): add `--no-owner` and use `-f file.sql` without `-Fc`.

The application can keep running while a backup is taken; the backup is a consistent snapshot.

## 4.3 Restore

> Restoring **replaces** the database contents with the backup. Take a backup of the current state first, and stop the application (`stop-app.bat`) so nobody saves meanwhile.

**pgAdmin – into the existing database:** right-click `fa_management` › **Restore…** › Format *Custom or tar* › choose the `.backup` file › tab *Data Options* (or *Restore options*): **Clean before restore** = Yes, **Owner** = Do not save › **Restore**. Then `start-app.bat`.

**pgAdmin – into a new database (to look at old data, or test a backup):** create a database e.g. `fa_management_restored` owned by `fa_app`, then Restore… into it as above (Clean not needed). Point a test copy of the application at it by setting `DB_NAME=fa_management_restored` in a staging `config.env`.

**Command line:**
```
pg_restore -h <db-server> -U fa_app -d fa_management --clean --if-exists --no-owner fa_management_<date>.backup
```

**After a failed deployment** the deployment script restores automatically. To go back by hand to the version and data before a deployment:
```
powershell -ExecutionPolicy Bypass -File deploy\rollback.ps1 -Env production -RestoreDatabase "D:\FA\environments\production\backups\fa_management_before_deploy_1_2_0_<time>.backup"
```

## 4.4 Test the backups

Once a month restore the latest nightly backup into `fa_management_restored` (4.3) and compare:
```sql
SELECT COUNT(*) AS records, SUM(amount) AS amount FROM fa_records;
SELECT MAX(logged_at) FROM activity_log;
```
with production. A backup that has never been restored is not a proven backup.

## 4.5 Year-End Archive copies

Archived periods live in `fa_management_archive`. Back it up with the same steps; restoring it brings the archived periods back to **Administration › Year-End Archive** (View / Restore).
