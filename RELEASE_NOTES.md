# Release Notes – FA Management System

Each version lists its changes under **New features**, **Enhancements** and **Bug fixes**.
Version numbers are MAJOR.MINOR.PATCH: PATCH = bug fixes only, MINOR = new features or
enhancements, MAJOR = a large change to how the application works.
The newest version is at the top. The release script refuses a version without a section here.

## 1.2.0 – 2026-10-21

### New features
- New-server installation kit: install-new-server.bat installs FA Management on a new server in one step – settings with a new JWT_SECRET, database connection check, optional restore of the existing data from a backup, application, database tables, first Admin on an empty database, start, health check, firewall port and start with Windows.
- Kits built by deploy\package-server-kit.ps1: Application kit (installer, application, scripts, guides – no data) and Database kit (setup-database.sql, schema.sql, production data backup).
- Setup EXEs built by deploy\package-installers.ps1: FA-Management-Setup-<version>.exe (wizard; Node.js included; creates the database login and databases, restores a chosen .backup, installs, starts; Start-menu entries and uninstall in Apps & features) and FA-Management-Database-<version>.exe (database server: login, databases and restore of the production data it contains).

### Enhancements
- Release and deployment scripts also run from a kit without the source code.
- deploy\setup-database.ps1 creates the login and databases with psql instead of pgAdmin, and restores a backup only into an empty database.
- The database password in config.env is quoted, so passwords with # or spaces work.

### Notes for users
- No change in the screens; same functions as 1.1.0.

## 1.1.0 – 2026-10-21

Ready for on-premises now and the cloud later: the same build runs in both; only the settings file changes.

### New features
- Settings page for every user: application version and release notes, own account, change own password, session rules; for Admin also where the application is connected (database server, archive database, time zone) – never the password.
- Sign-in tokens are standard JWTs (HS256) signed with JWT_SECRET, still checked against the server-side session (single login, idle sign-out and Admin sign-out keep working). Sign-ins made before this version stay valid until they end.
- Cloud-ready settings: DATABASE_URL, encrypted database connection (DB_SSL, DB_SSL_CA), connection pool size, reverse proxy (TRUST_PROXY), https-only (FORCE_HTTPS).
- Deployment kit: Nginx and IIS reverse-proxy configurations, Dockerfile and docker-compose for container platforms, automatic start with Windows, nightly backup task, database structure script and hand-over package (deploy\package-deliverables.ps1).
- Guides: Installation, On-Premises Deployment, Cloud Migration, Backup & Restore, Version Control, Release Notes template (docs\guides).

### Enhancements
- Times are saved and shown in the business time zone (APP_TIME_ZONE) whatever the server clock, so a cloud server running on UTC shows the same times as the office server.
- FA Data "search any column" uses its own index: with 20 users working at once on a year of data, a search takes about 0.2 s instead of 2 s.
- Health check (/api/health) also reports the version and environment, for monitoring and cloud load balancers.

### Bug fixes
- The database-change safety check now also catches row updates written with a table alias (UPDATE table alias SET …).

### Database changes
- 009_search_index.sql – searchable text column with an index on FA records (filled for existing records; no existing value changes).

## 1.0.1 – 2026-10-21

### Bug fixes
- Sign-in page: the Staging (SP) banner and the release notes window were squeezed into the right-hand panel; the banner now runs across the top and the release notes open over the whole window.

## 1.0.0 – 2026-10-21

First controlled release: the application rebuilt from the Google Apps Script version on
React.js, Node.js / Express.js and PostgreSQL, with the additions made during the rebuild.

### New features
- Masters: Branch, Category, Description, PO Client and Client / Cost Center – add, edit (popup), delete, search, Excel template / upload / export, bulk edit.
- Upload & Qty Plotting: Raw Data entry with Tally Booking Month, Excel bulk upload, Qty Plotting queue with credit-note handling and original-invoice lookup.
- FA Data: server-side filters (cost center, Tally month, dates, status, search), edit, details with change history, export, Admin bulk edit and Delete Filtered.
- Month-wise Data: Open › Under Review › Finalized › FAMS Uploaded, finalize checks, versions with FAMS and changes-only files, re-open with reason.
- LWM Reconciliation per Tally month; FAMS Template; Dashboard with filters; Period Reports by month, quarter, financial year with exports.
- Year-End Archive: back up, move a closed period to the archive database, view / export it, restore it.
- Security: one sign-in per user ID, sign-out after 30 minutes without activity, one browser tab at a time, invoice reservation while plotting, Activity Log.
- Version control: version shown on the sign-in screen and menu, release notes (What's New), Releases screen with staging approval.

### Enhancements
- Performance tested with one year of data (102,000 invoices, 298,000 lines): paged FA Data, database-side reports, streamed Excel exports.
- Keyboard entry in product rows (Enter, Tab, arrow keys) with its own scroll area.

### Bug fixes
- FAMS Template screen called a missing function (`loadFAMSClients`) in the Apps Script version.
- Typing Quantity before Unit Price put 0.00 in Product Amount.
- Client / Cost Center template download failed (invalid sheet name).
