import React, { useState } from 'react';
import { download, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert } from '../components/ui';

// Index.html FAMS Template page
export default function Fams() {
  const { withLoading } = useApp();
  const [alert, setAlert] = useState(null);

  const generate = () => withLoading('Generating FAMS Excel Template...', () => download('/fams/template', 'FAMS_Template.xlsx'))
    .then((n) => setAlert({ type: 'success', message: `${n} row(s) generated successfully. Check the Error Remark column for validation errors; Remarks contains only Narration.` }))
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  return (
    <section className="page">
      <div className="card">
        <h3 className="card-title">FAMS Template</h3>
        <p className="muted">Generate the FAMS upload template from FA/Qty Plotting data and Master mappings.</p>
        <Alert alert={alert} />
        <button type="button" className="btn btn-primary" onClick={generate}>Generate FAMS Template</button>
        <div className="muted" style={{ marginTop: 14 }}>
          ClientName is taken from PO Client Master (Client As Per PMO) and checked against the Client / Cost Center Master. PO Date and PO/client
          validations are taken from PO Client Master. Any mapping mismatch is written in the final Error Remark column.
        </div>
      </div>
    </section>
  );
}
