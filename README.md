# FA Management System

The FA Management System rebuilt from its Google Apps Script version
(`Fixed Asset app/google app script/Code.gs` and `Index.html`) on
**React.js**, **Node.js / Express.js** and **PostgreSQL**. Screens, menus,
messages and business rules follow the original; the Google Sheets workbook
becomes PostgreSQL tables.

## Screens

| Menu | Screen | What it does |
| --- | --- | --- |
| Dashboard | Dashboard | Total / Pending / Completed / Amount, plotted amount, Building-wise and Ledger-wise summaries with product breakdown, Data Archiving (Admin) |
| Masters | Client, Branch, Category, Description, PO, Client / Cost Center | Add / edit / delete, search, template, Excel upload (adds rows), export, bulk edit by Row Number |
| Transaction | Month-wise Data | Every Tally booking month: stage (Open › Under Review › Finalized › FAMS Uploaded), finalize checks, submit / send back / finalize / FAMS uploaded / re-open, saved versions with FAMS and changes-only files, month history, field-level change history (Admin) |
| Transaction | FA Data | All records with global filter, Edit (FA + Qty Plotting), Details, Delete, Export, Bulk Edit (Admin) |
| Transaction | Upload | Raw Data entry, Excel bulk upload, Qty Plotting queue and modal (Save moves to the next invoice) |
| Transaction | LWM | Tally upload (replaces the previous one), FA vs Tally by expense head, reset |
| Transaction | Ledger Master | Expense Head → Taggable / Non Taggable, Active |
| Users | Users (Admin) | Create users, edit name / role / status / password |
| Reports | Period Reports | View any Month, Quarter, Financial Year (Apr–Mar), Calendar Year, date range or all data, by cost center: totals, Month / Quarter / FY / Expense Head / Cost Center / Product-wise tables and the records. Exports: Summary, FA Data (detailed), FAMS Template, or one Complete Workbook |
| FAMS Template | FAMS Template | 91-column FAMS upload file with Error Remark validation |
| Activity Log | Activity Log (Admin) | The Activity Log sheet, searchable |

## Business rules (from Code.gs)

- **FA Code**: invoice month + year + 4-digit number per month, e.g. `SEP20260025`; never reused, also after archiving.
- **Raw Data**: Inv No, Date, PO No, Cost Center, Amount, Vendor, Expense Head required; Amount may not be zero. A negative amount is a credit note / reversal.
- **Qty Plotting**: one or more products with Quantity > 0, Taggable / Non Taggable, Product Amount ≥ 0, GST % 0–100. When Product Amount is entered, Unit Price = Product Amount ÷ Quantity. The total must equal the invoice amount exactly (±0.01). A record can be plotted once; later changes go through FA Data → Edit.
- **One user per invoice**: opening Plot Qty reserves the FA Code for that user. Other users do not see it in their Pending list (a note counts them; *Show them* lists them greyed out as *In progress – name*) and Next Invoice skips it; the server refuses a second reservation or save. The reservation ends on save, Cancel / close, moving to another invoice, leaving the page, sign-out or closing the browser, and lapses after 10 minutes without activity (`QTY_LOCK_MINUTES`). Admin can Release it. The Pending list refreshes every 30 seconds.
- **Credit notes** (negative amount): no products; Against Invoice No or Against Asset Code is required; one line "<Expense Head> (Credit Not/Reversal)", Non Taggable.
  Typing the Against Invoice No lists the matching original invoices of any month (positive records only) with amount, products and what was already reversed; records whose amount matches and with the same Expense Head come first. Selecting one fills Against Invoice No and Against Asset Code (its FA Code). Both can still be typed by hand.
- **Auto-mapping**: Pending records whose Expense Head is an active Non Taggable ledger are plotted automatically as one line when the Qty Plotting queue opens.
- **Edit**: saves FA fields and products together and marks the record Completed.
- **Product Master**: Taggable product names are added automatically and offered as suggestions.
- **Export / Bulk Edit**: one row per product; Client Name from PO Master (or *Common area* for PO No `BOQ`); FA Row Number / Qty Row Number identify what each row updates.
- **LWM**: Difference = FA amount − Tally amount; Matched within 0.01.
- **FAMS Template**: all records' product lines with Branch, Category, Description, PO and Client / Cost Center lookups; problems listed in Error Remark.
- **Bulk delete (Admin)**: FA Data › Delete Filtered removes the Qty Plotting, or the records, of the filtered list.
- **One sign-in per user ID** (Admins too): while the user is signed in on a browser that is open (it checks in every minute), any new sign-in with that ID, from another browser or computer, is refused with the browser, sign-in time and last activity. The attempt is logged (Activity Log: Login Blocked) and shown to the signed-in user. A browser closed without signing out frees the ID after about 3 minutes (`SESSION_OPEN_MINUTES`); an unused one after 30 minutes. Admin can end a session from Users › Sign out (keep at least 2 Admin accounts).
- **One tab per browser**: opening the app in a new tab moves it there (no new sign-in); older tabs show "open in another tab" with **Use this tab instead**. Signing out signs out every tab.
- **Admin only**: Users, FA Bulk Edit, Delete Filtered, Activity Log. Everything else is open to every logged-in user.

## Month-wise close

- **Tally Booking Month**: every record belongs to the month it is booked in Tally (Raw Data form, or the *Tally Booking Month* column / month choice of the bulk upload; default the invoice month). The FA Code still follows the invoice date. LWM Tally uploads are per month too.
- **Stages**: *Open* (everyone works) › *Under Review* (a user submitted; locked for users, Admin can still correct) › *Finalized* (Admin; locked for everyone) › *FAMS Uploaded* (Admin records the FAMS reference). The server refuses every change to a locked month: Raw Data, bulk upload, Qty Plotting, edit, delete, bulk edit, bulk delete, LWM upload / reset. New records cannot be booked into a month before the last finalized month.
- **Checks before finalizing**: records exist, Qty Plotting complete, credit notes linked, Tally matched (or an Admin remark accepting the difference), no FAMS Error Remark.
- **Versions**: finalizing keeps the month's FAMS rows as version 1, 2, … with a fingerprint. **Re-open** (any Admin, reason required) unlocks the month; finalizing again gives a **changes-only FAMS file** (Added / Changed / Removed lines, with the changed columns) to load into FAMS.
- **Change history**: every edit, bulk edit and delete records field, old value, new value, user, time and screen (FA Data › Details and Month-wise Data, Admin).
- **Existing data**: months before the month the update was installed (or imported) are marked Finalized.
- **Consolidated reports**: Period Reports for several months (quarter, financial year, calendar year, dates, all) are Admin only; users view and export one Tally month at a time.

## Year-End Archive (Admin)

Administration › Year-End Archive moves a closed period out of the live database while keeping every master:

1. Choose a financial year (or From / To month) and **Check period**: every month must be Finalized / FAMS Uploaded and before the current financial year.
2. Type the confirmation (e.g. `ARCHIVE FY 2025-26`). The app then takes a **full backup** (pg_dump, to `backups\` or `BACKUP_DIR`), **copies** the period's FA records, Qty Plotting lines, Tally uploads, month close records / FAMS versions and change history to the archive database (`ARCHIVE_DB_NAME`, default `<DB_NAME>_archive`, created automatically), **checks** counts and amount, and only then **deletes** it from the live database in one transaction. If any step fails nothing is deleted.
3. Masters, Users, the Activity Log and FA Code counters are never touched. Archived months cannot be booked into.
4. **View** shows an archived period (search, product lines, change history) and exports it as FA Data. **Restore** (typed confirmation, backup first) puts it back exactly as it was. Every archive and restore is in the Activity Log.

Measured: a 5-month period with 42,500 records / 126,630 lines archived in 15 s and restored in 16 s, including the backups. The application server needs PostgreSQL's `pg_dump` (client tools); set `PG_DUMP_PATH` if it is not found automatically.

## Releases and environments (version control)

| Environment | Address | Database | Started with |
| --- | --- | --- | --- |
| Production | http://localhost:3100 | `fa_management` | `start-app.bat` / `stop-app.bat` |
| Staging (SP) | http://localhost:3300 (orange STAGING banner) | `fa_management_staging` (copy of production) | `start-staging.bat` / `stop-staging.bat` |
| Development | http://localhost:3101 (API 5101) | from `server\.env` | `start-dev.bat` / `stop-dev.bat` |

Environments are installed under the `root` folder of `deploy\environments.json` (one folder each: `app` = running version, `previous` = version before, `config.env`, `backups`, `logs`).
First time: `deploy\setup-environment.bat staging` and `deploy\setup-environment.bat production`.

**Version numbers** are MAJOR.MINOR.PATCH: PATCH = bug fixes, MINOR = new features / enhancements, MAJOR = big changes.
The version is shown on the sign-in screen and at the bottom of the menu; it opens the release notes (What's New).

**For every change:**

1. Develop and test in the development copy; commit the changes in Git.
2. Add a section to `RELEASE_NOTES.md`: `## 1.1.0 – <date>` with *New features*, *Enhancements*, *Bug fixes*.
3. `deploy\release.bat 1.1.0` – checks the version is new, the release notes exist, database changes are add-only (`npm run check-migrations`) and all tests pass; builds the screens; writes `releases\1.1.0\` and `releases\FA-Management-1.1.0.zip`; commits and tags `v1.1.0` in Git.
4. `deploy\deploy.bat staging 1.1.0` – refreshes staging with a copy of production data (`--NoRefresh` keeps it), backs up, installs, applies database changes, health-checks.
5. Users test on staging. An Admin approves the version in **Administration › Releases** on staging, noting what was tested.
6. `deploy\deploy.bat production 1.1.0` – refused unless approved on staging. Backs up the production database, keeps the running version as `previous`, installs, applies database changes, health-checks. Any failure rolls back automatically (previous version; database restored from the backup if it was changed).
7. If a problem shows up later: `deploy\rollback.bat production` (add `-RestoreDatabase "<backup>"` in PowerShell to also restore the data).

**Database changes** are new files in `database/migrations` and must be add-only (new tables / columns / indexes). The release check blocks DROP, TRUNCATE, DELETE, row UPDATEs, type changes and renames unless the file explains why (`-- allow-data-change: <reason>`) and it is reviewed. An applied migration file must never be edited: its fingerprint is stored and a changed file stops the update.

**Administration › Releases** shows the version running, every deployment of that environment (who, when, database changes, backup file) and, on staging, the approval.

## Quick start (Windows)

Double-click **`start-app.bat`** to start Production (the installed release, http://localhost:3100) and **`stop-app.bat`** to stop it.
Before the first release is installed, `start-app.bat` starts the development copy (`start-dev.bat`, http://localhost:3101).
`server\.env` must exist first (see Setup).

## Setup

Requires Node.js 18+ and PostgreSQL 13+.

```bash
cd server
copy .env.example .env      # set DB_PASSWORD (and DB_NAME if not fa_management)
npm install
npm run migrate             # create the database first, e.g. CREATE DATABASE fa_management;
npm run seed                # first Admin: admin / admin123 (as in the original) - change it in Users
npm run dev                 # API on http://localhost:5100

cd ../client
npm install
npm start                   # screens on http://localhost:3100
```

Single-port install: run `npm run build` in `client` and set `CLIENT_BUILD_DIR`
to the `client/build` folder; the API then serves the screens too.

## Moving the data from Google Sheets

1. Open the FA Management spreadsheet → **File › Download › Microsoft Excel (.xlsx)**.
   If Archive was used, download the **FA Management Archive** spreadsheet as well; its
   records are loaded as normal FA records (the new app has no archive).
2. From `server`, check first, then import:

```bash
npm run import-sheets -- --file="FA Management.xlsx" --archive="FA Management Archive.xlsx" --dry-run
npm run import-sheets -- --file="FA Management.xlsx" --archive="FA Management Archive.xlsx"
```

All sheets are imported in one transaction: Users (passwords re-stored as
encrypted hashes), Raw Data with FA Codes and statuses, Qty Plotting, LWM
Tally, Ledger Master, Product Master, the six masters and the Activity Log.
FA Code counters continue after the highest imported code of each month.
Run it once; rows that could not be imported are listed.

## Volume

Load-tested with one year at the expected volume (102,000 invoices, 298,000 product lines, 150 buildings): FA Data, Period Reports records and filters load one page at a time from the server; Dashboard and Period Reports are summed in PostgreSQL; Excel exports are written row by row (a full-year FAMS file, 300,000 rows, in about 25 s without running out of memory). Large exports keep the frozen header and column widths but not the bold header. `REPORT_WORK_MEM` (default 32MB) sets the memory for the report queries.

## Tests

`cd server && npm test` re-creates a throwaway database `fa_management_test`
and runs the API tests (FA Codes, validation messages, Qty Plotting, credit
notes, auto-mapping, edit, export / bulk edit, masters, LWM, dashboard, FAMS,
users, bulk delete, import).

## Changes from the Apps Script version

Behaviour is kept unless listed here.

| Area | Apps Script | New version | Why |
| --- | --- | --- | --- |
| Passwords | Plain text in the Users sheet | bcrypt hashes | Security |
| Inactive users | Could keep using an open session | Sessions end immediately | Security |
| Session length | Signed out 6 hours after sign-in | Signed out after 30 minutes without activity (warning 2 minutes before; typing counts, automatic refreshes do not); 12 hours at most. `SESSION_IDLE_MINUTES`, `SESSION_SECONDS` | Security |
| Sessions | Same user could be signed in on many browsers / tabs | One sign-in per user, one tab per browser | Avoid two copies saving over each other |
| Own account | Admin could remove own Admin role | Blocked | Avoid lock-out |
| Bulk upload dates | An unreadable date failed the whole upload | That row is reported and skipped | Clearer errors |
| Bulk edit FA | A Qty Row Number of another FA could be overwritten | Rejected as invalid | Data safety |
| Bulk edit FA | FA row updated even if its Qty row was invalid | Whole row skipped and reported | Consistency |
| Delete FA, LWM, Ledger | Not in the Activity Log | Logged | Audit trail |
| Archive | Separate Google spreadsheet + link | Removed; all records stay in FA Data | Not needed |
| Months | No month close | Month-wise close with locks, versions, re-open and changes-only FAMS file | Data integrity |
| Activity Log | Only visible inside the spreadsheet | Activity Log screen (Admin) | Sheet no longer exists |
| Excel files | .xlsx and .xls | .xlsx (save .xls as .xlsx first) | Reader support |
| Qty Plotting rows | Typing Quantity first put 0.00 in Product Amount | Amount calculated once Quantity and Unit Price are both entered | Typing error |
| FA Data | All rows on one page | 100 rows per page (filter covers all rows) | Speed with large data |
| Ledger Master edit | Renaming an Expense Head added a new row | Edit renames that row | Fewer duplicates |
| FAMS Template screen | Called a missing function (`loadFAMSClients`) | Fixed | Bug |
