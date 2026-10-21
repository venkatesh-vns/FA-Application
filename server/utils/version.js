// Application version (version.json at the app root, written by the release
// script) and the release notes (RELEASE_NOTES.md) for the screens.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function appInfo() {
  let info = {};
  try { info = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')); } catch { /* not released yet */ }
  const env = (process.env.APP_ENV || 'production').toLowerCase();
  return {
    version: info.version || require('../package.json').version,
    releasedAt: info.releasedAt || '',
    commit: info.commit || '',
    environment: env,
    environmentLabel: env === 'staging' ? 'Staging (SP)' : env === 'development' ? 'Development' : 'Production',
  };
}

/**
 * RELEASE_NOTES.md as [{ version, date, sections: [{ title, items }] }], newest first:
 *   ## 1.1.0 - 2026-11-05
 *   ### New features
 *   - ...
 */
function releaseNotes() {
  let md = '';
  try { md = fs.readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf8'); } catch { return []; }
  return md.split(/^## /m).slice(1).map((block) => {
    const [head, ...rest] = block.split(/\r?\n/);
    const m = head.match(/^v?(\d+\.\d+\.\d+)\s*[-–—]*\s*(.*)$/);
    const sections = [];
    let cur = null;
    rest.forEach((lineRaw) => {
      const line = lineRaw.trimEnd();
      if (/^###\s+/.test(line)) { cur = { title: line.replace(/^###\s+/, ''), items: [] }; sections.push(cur); return; }
      const item = line.match(/^\s*[-*]\s+(.*)$/);
      if (item) {
        if (!cur) { cur = { title: 'Changes', items: [] }; sections.push(cur); }
        cur.items.push(item[1]);
      }
    });
    return { version: m ? m[1] : head.trim(), date: m ? m[2].trim() : '', sections };
  }).filter((r) => /^\d+\.\d+\.\d+$/.test(r.version));
}

module.exports = { appInfo, releaseNotes, ROOT };
