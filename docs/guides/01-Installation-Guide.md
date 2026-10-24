# 1. Installation Guide – FA Management System

This guide installs the application on a new server. The **same release package** is used on-premises and in the cloud; only the settings file (`config.env` / `.env`) differs.

## 1.0 Easiest: the setup EXEs (recommended)

`deploy\package-installers.ps1 -Version <version>` builds `deliverables\FA-Management-<version>-Installers\`:

| File | Use |
| --- | --- |
| `FA-Management-Setup-<version>.exe` | The application, with Node.js inside. A wizard asks for the database server, the password of `postgres` (to create the login and databases), the application login and its password, and optionally the `.backup` file with the existing data. It then installs, starts, opens the firewall port and starts with Windows. Uninstall it from **Apps & features** (the database, settings and backups are kept). |
| `FA-Management-Database-<version>.exe` | For a database on a separate server. It creates the login and the databases and restores the production data it contains (or another `.backup`, or nothing). |
| `fa_management_<version>.backup` | The production data, for the setup EXE's **Browse...** or for pgAdmin › Restore. |

**Same server (usual):** install PostgreSQL 16+, then right-click `FA-Management-Setup-<version>.exe` › **Run as administrator**. On the Data page choose `fa_management_<version>.backup`, then open `http://localhost:3100`.
**Separate database server:** run `FA-Management-Database-<version>.exe` there first. Then run the setup EXE on the application server with the postgres password **empty** and the backup file **empty**.

Each step runs in a PowerShell window, and the messages are saved in `C:\FA\setup.log`. Silent installation is also possible: `FA-Management-Setup-<version>.exe /S /D=C:\FA /DBHOST=... /BACKUP=...`, with the passwords in `FA_DB_PASSWORD` and `FA_PG_ADMIN_PASSWORD`.

The `.backup` and the Database EXE contain all the business data. Keep them on secure internal storage.

## 1.0.1 Installation with the kits (zip)

Two kits are built for every version with `deploy\package-server-kit.ps1 -Version <version>`:

| Kit | Contents |
| --- | --- |
| `FA-Management-<version>-Application-Kit.zip` | `install-new-server.bat`, the application, deploy scripts, start / stop files, guides (no data) |
| `FA-Management-<version>-Database-Kit.zip` | `setup-database.sql`, `schema.sql`, migrations, and a **backup of the production data** (keep secure) |

1. Install Node.js 22 LTS and PostgreSQL 16+ (with pgAdmin and Command Line Tools).
2. Edit the password in `setup-database.sql` and run it in pgAdmin as `postgres`.
3. Unzip the application kit (e.g. `C:\FA\kit`), right-click `install-new-server.bat` › **Run as administrator**, answer the questions (database server / port / name / login / password, install folder, port, and the `.backup` file of the database kit to bring the existing data – or Enter for an empty database).
4. Open `http://localhost:3100` (office PCs: `http://<server>:3100`).

The installer writes the settings with a new `JWT_SECRET`, checks the database connection, restores the data (only into an empty database), installs and starts the application, creates / updates the tables, creates a first Admin on an empty database, opens the firewall port and makes the application start with Windows. The rest of this guide describes the same steps by hand.

## 1.1 What you need

| Item | Version | Notes |
| --- | --- | --- |
| Windows Server 2019 / 2022 (or Windows 10/11 for a pilot) | – | Linux works too (see the Cloud Migration Guide). |
| Node.js | 22 LTS | https://nodejs.org – install for all users, "Add to PATH". |
| PostgreSQL | 16 or newer | On the same server or a separate internal server. Includes **pgAdmin** and the command-line tools (`pg_dump`, `pg_restore`, `psql`). |
| PostgreSQL client tools on the **application** server | same major version | Needed for the automatic backups. If PostgreSQL runs on another server, install "Command Line Tools" only on the application server. |
| Release package | `FA-Management-<version>.zip` | From `releases\` (see the Version Control Guide). |

Hardware for 120+ buildings, 25,000+ lines a month and 5–20 users: **application** 4 vCPU / 8 GB RAM / 60 GB SSD; **database** 4 vCPU / 16 GB RAM / 200 GB SSD (the data grows about 100 MB a year; the rest is for backups). One server with 8 vCPU / 16 GB can hold both.

## 1.2 Create the database and its login

In **pgAdmin › Query Tool** (connected as `postgres`), or `psql`:

```sql
-- the application's own login: not a superuser
CREATE ROLE fa_app LOGIN PASSWORD 'choose-a-strong-password';
-- the database belongs to that login, so the application can create its tables,
-- indexes and the pg_trgm search extension
CREATE DATABASE fa_management OWNER fa_app ENCODING 'UTF8';
-- Year-End Archive copies closed years here (created by the app if allowed)
CREATE DATABASE fa_management_archive OWNER fa_app ENCODING 'UTF8';
-- the test copy (Staging / UAT)
CREATE DATABASE fa_management_staging OWNER fa_app ENCODING 'UTF8';
ALTER ROLE fa_app CREATEDB;   -- lets the staging refresh re-create fa_management_staging
```

`pg_trgm` (fast "contains" search) is a trusted extension: the database owner can create it. If your DBA prefers, run `CREATE EXTENSION pg_trgm;` in `fa_management` as `postgres` once.

**Database on a separate server:** in that server's `postgresql.conf` set `listen_addresses = '*'` and in `pg_hba.conf` allow only the application server, e.g. `host fa_management,fa_management_archive,fa_management_staging fa_app 10.0.0.15/32 scram-sha-256`; open port 5432 in its firewall for that address only. Restart PostgreSQL.

## 1.3 Install the application

1. Copy the source folder (or unzip `FA-Management-<version>-source.zip`) to e.g. `D:\FA\source`. It contains the `deploy\` scripts.
2. Copy the release package to `D:\FA\source\releases\` and unzip it to `releases\<version>\app` (a release built on this server is already there).
3. In `deploy\environments.json` set `root` (e.g. `D:\FA\environments`) and, if needed, the ports and database names.
4. Create `server\.env` from `server\.env.example` with the database login (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`). It is only used as the source of the login for the next step.
5. Set up both environments (creates `config.env` for each, with its own `JWT_SECRET`):
   ```
   deploy\setup-environment.bat production
   deploy\setup-environment.bat staging
   ```
6. Review `D:\FA\environments\production\config.env` (see 1.4).
7. Install the version the normal way – staging first, then production (even the very first time):
   ```
   deploy\deploy.bat staging <version>
   ```
   On an empty production database the staging copy is empty too; the deployment creates all tables. Create the first Admin on staging (1.5), sign in to staging, test, and approve the version in **Administration › Releases**. Then:
   ```
   deploy\deploy.bat production <version>
   ```
   and create the first Admin on production (1.5).
8. Start production automatically with Windows (run PowerShell as Administrator):
   ```
   powershell -ExecutionPolicy Bypass -File deploy\install-autostart.ps1 -Env production
   ```
9. Let office PCs reach the application – Windows Firewall on the application server:
   ```
   netsh advfirewall firewall add rule name="FA Management" dir=in action=allow protocol=TCP localport=3100
   ```
   Users then open `http://<server-name-or-IP>:3100` (or the address set up in IIS, see the On-Premises Deployment Guide).

## 1.4 The settings file (`config.env` → `app\server\.env`)

No connection details are in the code. Every deployment copies the environment's `config.env` into the installed application as `server\.env`. The application connects with these values when it starts:

| Setting | Example | Meaning |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` | `10.0.0.20` / `5432` | Database server |
| `DB_NAME` | `fa_management` | Database |
| `DB_USER` / `DB_PASSWORD` | `fa_app` / … | Application login |
| `DATABASE_URL` | `postgres://fa_app:…@host:5432/fa_management` | Alternative to the five values (cloud) |
| `DB_SSL` | `false` / `true` / `verify` | Encrypted database connection (cloud: `true`) |
| `PORT` | `3100` | Port users open |
| `JWT_SECRET` | 96 random characters | Signs the sign-in tokens; different per environment |
| `APP_TIME_ZONE` | `Asia/Kolkata` | Business time, whatever the server clock |
| `TRUST_PROXY` / `FORCE_HTTPS` | `1` / `true` | Behind IIS / Nginx with https |
| `BACKUP_DIR` | `D:\FA\environments\production\backups` | Backups taken by the app |

After changing `config.env`, run `deploy\env.ps1 -Env production -Action restart` (the running copy `app\server\.env` is refreshed at each deployment; for an immediate change edit both or redeploy). **Administration › Settings** shows where the application is connected (never the password).

## 1.5 First Admin user

On a new, empty database (replace `production` by `staging` for the staging copy):
```
cd D:\FA\environments\production\app\server
node scripts\seedAdmin.js
```
This creates `admin` / `admin123`. Sign in and change the password at once (**Settings › Change my password**), then create the users (**Administration › Users**). Keep at least two Admin accounts.

## 1.6 Check

- `http://<server>:3100` shows the sign-in page with **Version x.y.z** at the bottom.
- `http://<server>:3100/api/health` returns `"database":"connected"`.
- **Administration › Releases** lists the deployment.

## 1.7 Keep the server available (no sleep, start after a restart)

When the server sleeps, office PCs cannot reach FA Management. Run **Configure-Server.bat** once on the server: right-click it and choose **Run as administrator**. It is in the application kit, under Start menu › FA Management System › Server settings (keep awake), and in `deliverables\FA-Management-Server-Settings`. The setup EXE runs it as well when "Start with Windows…" is ticked.

| Setting | Effect |
| --- | --- |
| Power | High performance plan. The server never sleeps, hibernates or turns off its disk. Fast Startup is off, closing a laptop lid or pressing the sleep button does nothing, and the network adapters stay powered. |
| PostgreSQL service | Starts with Windows and restarts itself after a failure (1 minute later). |
| FA Management | A Task Scheduler task (run as SYSTEM) starts it with Windows and checks every 5 minutes, starting it again if it stopped. |
| Windows Update | No automatic restart during the working hours you enter (default 7–23) or while someone is signed in. |

Double-clicking it without administrator rights only shows the current state; `configure-server.ps1 -CheckOnly` does the same. It is safe to run again, for example after a large Windows update. Also recommended: a UPS for the server, and installing Windows updates with a restart outside working hours. About 1–2 minutes after a restart, `http://<server>:3100` works again by itself.
## 1.8 Update an installed server (all data kept)

`deploy\package-installers.ps1 -Version <v>` also builds `deliverables\FA-Management-<v>-Update(.zip)`. Copy it to the server and right-click **Update-Server.bat** › **Run as administrator**:

1. **Run 1:** copies the new version into the installation, takes a full backup of the production database (`_before_update_<v>`), and installs the version on Staging / UAT with a fresh copy of the production data. Production keeps running unchanged.
2. An Admin checks Staging (`http://<server>:3300`) and approves the version in **Administration › Releases**.
3. **Run 2:** reads every business table (rows and content), installs the version on Production (another backup, add-only database changes, health check, automatic rollback on failure), reads the tables again, and reports **No data changed**. It then applies the server settings (1.7): no sleep, and automatic start after a restart.

Settings (`config.env`), data, backups and the folder and port layout are kept. Users sign in again after the update. To go back: `deploy\rollback.ps1 -Env production`.
