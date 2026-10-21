# 2. On-Premises Deployment Guide (Phase 1)

```
Office PCs (browser)  ──LAN──►  Application server : port 3100  (Node.js: screens + API)
                                        │  DB_HOST / DB_PORT from config.env
                                        ▼
                                PostgreSQL : port 5432  (same server or a separate internal server)
```

| Environment | Address | Database | Purpose |
| --- | --- | --- | --- |
| Production | `http://<server>:3100` | `fa_management` | Daily work |
| Staging / UAT (SP) | `http://<server>:3300` | `fa_management_staging` (copy of production) | Users test every new version before production; orange STAGING banner |

Installation: see the **Installation Guide**. This guide covers running and operating the servers.

## 2.1 Folders on the application server

```
D:\FA\source\                     application source + deploy scripts (Git repository)
   releases\<version>\app\        release packages built by deploy\release.bat
D:\FA\environments\               root in deploy\environments.json
   production\app\                the running version          (server, client\build, database\migrations)
   production\previous\           the version before it        (for rollback)
   production\config.env          production settings           (database login, JWT_SECRET, port …)
   production\backups\            backups taken before each deployment / Year-End Archive
   production\logs\               app.out.log, app.err.log, deploy_<version>_<time>.log
   staging\...                    the same for Staging / UAT
```

## 2.2 Start, stop, status

| Task | Command |
| --- | --- |
| Start / stop production | `start-app.bat` / `stop-app.bat` |
| Start / stop staging | `start-staging.bat` / `stop-staging.bat` |
| Status / restart | `powershell -File deploy\env.ps1 -Env production -Action status` (or `restart`) |
| Start with Windows | `deploy\install-autostart.ps1 -Env production` (Administrator; checks every 5 minutes and starts it again if it stopped) |
| Logs | `D:\FA\environments\production\logs\app.err.log` |
| Health | `http://<server>:3100/api/health` |

## 2.3 Access over the local network

* Open port 3100 (and 3300 for UAT) in Windows Firewall on the application server (Installation Guide 1.3 step 9).
* Users open `http://<server-name>:3100`. A friendly address such as `http://fa.company.local` needs a DNS record from IT pointing at the server.
* **Optional – IIS with https on the LAN:** install IIS with *URL Rewrite* and *Application Request Routing*, enable the ARR proxy, create a site with an https binding (company certificate) and copy `deploy\iis\web.config` into its folder. Then in `config.env`: `TRUST_PROXY=1`, `FORCE_HTTPS=true`, `CLIENT_URL=https://fa.company.local`, and redeploy (or restart). Users open `https://fa.company.local`; keep port 3100 closed in the firewall so everyone goes through IIS.

## 2.4 Database on a separate internal server

Only `config.env` changes: `DB_HOST=<database server>`, and if required `DB_SSL=true`. The database server must allow the application server (Installation Guide 1.2). Restart the application; **Settings** (Admin) shows the connected server.

The automatic backups run `pg_dump` from the application server, so the PostgreSQL client tools must be installed there (`PG_DUMP_PATH` if they are not found).

## 2.5 Deploying a new version

Always: **release → staging → user testing → approval → production**. See the Version Control Guide. In short:

```
deploy\release.bat 1.2.0
deploy\deploy.bat staging 1.2.0
   (users test on http://<server>:3300, an Admin approves in Administration › Releases)
deploy\deploy.bat production 1.2.0
```

Every deployment backs up the database first, keeps the previous version, applies only add-only database changes, checks the application is healthy and rolls back by itself if anything fails. Existing masters and transactions are never deleted or rewritten by a deployment.

## 2.6 Security in place

| Requirement | Implementation |
| --- | --- |
| JWT authentication | Sign-in returns a signed JWT (HS256, `JWT_SECRET`); every request checks it **and** its server-side session. |
| Role-based access | Admin / User; Admin-only screens and actions are checked on the server. |
| Password encryption | bcrypt hashes; users change their own password in Settings. |
| Session management | Signed out after 30 minutes without activity (warning 2 minutes before), 12 hours at most; one browser tab at a time. |
| Single user login | One sign-in per user ID; a second sign-in is refused and reported to the signed-in user; Admin can end a session (Users). |
| Audit logs / activity tracking | Activity Log (every save, change, deletion, sign-in, refused sign-in, archive, deployment approval) and field-level change history. |
| Rate limiting | 20 failed sign-ins per 15 minutes per address. |

## 2.7 Daily / weekly checks

* Backups: see the Backup & Restore Guide (scheduled nightly backup recommended).
* Disk space on the backup folder.
* `app.err.log` for errors.
