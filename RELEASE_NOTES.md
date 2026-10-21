# Release Notes – FA Management System

Each version lists its changes under **New features**, **Enhancements** and **Bug fixes**.
Version numbers are MAJOR.MINOR.PATCH: PATCH = bug fixes only, MINOR = new features or
enhancements, MAJOR = a large change to how the application works.
The newest version is at the top. The release script refuses a version without a section here.

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
