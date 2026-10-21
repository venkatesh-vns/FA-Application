# 3. Cloud Migration Guide (Phase 2)

The application needs **no code change** to move to the cloud. The same release package (or the Docker image built from the same source) runs there; only the settings change.

```
Users ─► app.company.com (DNS) ─► HTTPS certificate ─► Nginx / IIS / cloud load balancer
      ─► Node.js app (screens + /api, port 3100) ─► PostgreSQL (managed service or VM)
```

## 3.1 Choose the target

| Platform | Application | Database |
| --- | --- | --- |
| Microsoft Azure | Windows or Linux VM, or App Service / Container Apps (Docker image) | Azure Database for PostgreSQL – Flexible Server |
| AWS | EC2 (Windows/Linux), or ECS / App Runner (Docker image) | Amazon RDS for PostgreSQL |
| DigitalOcean | Droplet, or App Platform (Docker image) | Managed PostgreSQL |
| Any other | Any VM with Node.js 22, or any container platform | PostgreSQL 16+ |

PostgreSQL version: the same or newer major version than on-premises.

## 3.2 Prepare the cloud database

1. Create the PostgreSQL server (private network / firewall: allow only the application).
2. Create the login and databases as in Installation Guide 1.2 (`fa_app`, `fa_management`, `fa_management_archive`). Managed services usually do not allow `CREATEDB`: create the archive database yourself, and set `ARCHIVE_DB_NAME` if its name differs.
3. Enable the `pg_trgm` extension (Azure: add it to the server parameter `azure.extensions`; RDS / DigitalOcean: allowed).
4. Note the connection: host, port, database, user, password, and whether SSL is required (it usually is).

## 3.3 Move the data (planned downtime about 30 minutes)

1. Announce the time; users sign out.
2. On the on-premises server: `stop-app.bat` (no one can change data now).
3. Take the final backup (custom format, pgAdmin can restore it):
   ```
   "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h localhost -U fa_app -Fc -f fa_management_final.backup fa_management
   ```
   Also back up `fa_management_archive` the same way if Year-End Archive has been used.
4. Copy the file to a machine that can reach the cloud database, and restore:
   ```
   pg_restore -h <cloud-host> -U fa_app -d fa_management --no-owner --no-privileges fa_management_final.backup
   ```
   (or pgAdmin: right-click the database › Restore… › Format *Custom or tar*, Role *fa_app*, Options: *Do not save owner / privileges*).
5. Check counts on both sides (pgAdmin Query Tool):
   ```sql
   SELECT (SELECT COUNT(*) FROM fa_records) AS records, (SELECT COUNT(*) FROM qty_lines) AS lines,
          (SELECT SUM(amount) FROM fa_records) AS amount, (SELECT COUNT(*) FROM branch_master) AS buildings,
          (SELECT MAX(filename) FROM schema_migrations) AS last_change;
   ```
   The numbers must be identical.

## 3.4 Install the application in the cloud

**A. Virtual machine (Windows or Linux)** – install Node.js 22 and the PostgreSQL client tools, copy the source and release package, run `deploy\setup-environment.bat production` (Windows) or create `server/.env` from `server/.env.example` (Linux), then set **only these** settings:

```
DB_HOST=<cloud database host>          (or DATABASE_URL=postgres://fa_app:...@host:5432/fa_management)
DB_PORT=5432
DB_NAME=fa_management
DB_USER=fa_app
DB_PASSWORD=<password>
DB_SSL=true                            (verify + DB_SSL_CA=<ca.pem> to also check the certificate)
CLIENT_URL=https://app.company.com
TRUST_PROXY=1
FORCE_HTTPS=true
JWT_SECRET=<new 96-character secret for the cloud>
APP_TIME_ZONE=Asia/Kolkata             (keep: cloud servers run on UTC; times stay in India time)
```

Reverse proxy and certificate:
* **Linux + Nginx:** copy `deploy/nginx/fa-management.conf`, set `server_name` and the certificate (Let's Encrypt: `sudo certbot --nginx -d app.company.com`). Run the app as a service, e.g. `systemd` unit with `WorkingDirectory=/opt/fa/app/server`, `ExecStart=/usr/bin/node server.js`, `Restart=always`.
* **Windows + IIS:** `deploy/iis/web.config` as in the On-Premises Guide 2.3, with the public certificate.

**B. Container platform** – build once from the release's source: `docker build -t fa-management:<version> .`, push it to the platform's registry, and set the settings above as the platform's environment variables (never in the image). The container applies the add-only database changes and starts; `/api/health` is its health check. `docker-compose.yml` runs app + database on a single VM if no managed database is used.

## 3.5 Switch over

1. DNS: point `app.company.com` at the cloud proxy / load balancer.
2. Open `https://app.company.com` – sign-in page shows the same **Version**; **Settings** (Admin) shows the cloud database and *Encrypted connection: Yes*.
3. Check: Dashboard totals, FA Data count, a Period Report export, Month-wise Data, a Qty Plotting save, Activity Log. All data, masters, transactions, reports and dashboards are the same – nothing in the data depends on the server.
4. Keep the on-premises server stopped but intact for two weeks (fallback: start it again and point DNS back).

## 3.6 After the migration

* Staging / UAT: a second cloud app with its own database (`fa_management_staging`) and settings (`APP_ENV=staging`) – same release process.
* Backups: enable the platform's automated backups (point-in-time restore) **and** keep the application's own backups (`BACKUP_DIR` on persistent storage).
* Deployments: same steps as on-premises (release → staging → approval → production). On containers: deploy the new image to staging, approve, then promote the same image to production.
