const multer = require('multer');
const path = require('path');
const { httpError } = require('../utils/httpError');

// Uploaded Excel files are stored briefly in /uploads, read, then deleted
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`),
});

function fileFilter(req, file, cb) {
  if (path.extname(file.originalname).toLowerCase() === '.xlsx') return cb(null, true);
  cb(httpError(400, 'Please upload the Excel template (.xlsx). Save older .xls files as Excel Workbook (.xlsx) first.'));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 20 * 1024 * 1024 } });

module.exports = { upload };
