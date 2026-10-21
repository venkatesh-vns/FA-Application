# 5. Version Control Guide

## 5.1 Version numbers

`MAJOR.MINOR.PATCH`, e.g. **1.2.3**

| Change | Example | New version |
| --- | --- | --- |
| Bug fix only | wrong total on a report | 1.2.3 → **1.2.4** |
| New feature or enhancement | new filter, new export | 1.2.4 → **1.3.0** |
| Large change to how the application works | new module replacing an old one | 1.3.0 → **2.0.0** |

Every release gets a new number – also a one-line fix. The number is shown on the **sign-in page**, at the bottom of the **menu** and in **Settings**; it opens the release notes (What's New).

## 5.2 Where versions are tracked

| What | Where |
| --- | --- |
| Source code of every version | Git repository, tag `v<version>` (`git log`, `git show v1.2.0`, `git diff v1.1.0 v1.2.0`) |
| Version number | `version.json` (written by the release script) |
| Bug fixes / enhancements / features of each version | `RELEASE_NOTES.md` (template: `RELEASE_NOTES_TEMPLATE.md`) |
| Release package | `releases\<version>\app` and `releases\FA-Management-<version>.zip` |
| Deployments (who, when, database changes, backup), approvals | **Administration › Releases** of each environment |

## 5.3 The release process (mandatory)

```
develop ─► commit ─► release notes ─► deploy\release.bat ─► Staging / UAT ─► user testing ─► approval ─► Production
```

1. **Develop** in the development copy (`start-dev.bat`, http://localhost:3101) and commit:
   `git add -A` and `git commit -m "What changed"`.
2. **Release notes:** add a section at the top of `RELEASE_NOTES.md` (copy it from the template) and commit it.
3. **Release:**
   ```
   deploy\release.bat 1.3.0
   ```
   It stops if the version is not new, the release notes have no section for it, there are uncommitted changes, a database change is not add-only, or any automated test fails. Then it builds the screens, writes the package and zip, commits `version.json` and tags `v1.3.0`.
4. **Staging / UAT:**
   ```
   deploy\deploy.bat staging 1.3.0
   ```
   Staging is refreshed with a copy of production, backed up, the version installed and its database changes applied on that copy – so they are proven on real data before production.
5. **User testing** on `http://<server>:3300` (orange STAGING banner). Fix and release a new version (1.3.1) if anything is wrong – never edit a released version.
6. **Approval:** an Admin signs in to staging, **Administration › Releases › Approve for production**, and writes what was tested and by whom.
7. **Production:**
   ```
   deploy\deploy.bat production 1.3.0
   ```
   Refused unless 1.3.0 was approved on staging. Backup → install (previous version kept) → database changes → health check → recorded. Any failure rolls back automatically.
8. **If a problem appears later:** `deploy\rollback.bat production` (previous version), or with the database: Backup & Restore Guide 4.3.

## 5.4 Database changes without affecting existing data

* Every change is a new numbered file in `database/migrations` (e.g. `010_new_report.sql`); it runs once, in a transaction, at the next deployment.
* **Add-only:** new tables, columns (with defaults), indexes. The release check refuses `DROP`, `TRUNCATE`, `DELETE`, row `UPDATE`, column type changes and renames. If one is truly needed (e.g. filling a new column), the file must explain it in a line `-- allow-data-change: <reason>`; the check lists it for review.
* **Never edit an applied migration.** Each file's fingerprint is stored when it runs; a changed file stops the deployment. Write a new migration instead.
* Changes are always applied to the staging copy of production first.

## 5.5 Hot fix

An urgent fix follows the same path, faster: commit the fix, add `## x.y.(z+1)` to the release notes, `release.bat`, `deploy.bat staging`, quick test, approve, `deploy.bat production`. Only in an emergency `release.ps1 -SkipTests` – and test it on staging all the same.
