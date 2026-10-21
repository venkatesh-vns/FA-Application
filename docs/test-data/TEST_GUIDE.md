# FA Management System - Test Data Guide

The local database was cleared on 15/10/2026 (all masters and transactions; the
`admin` user was kept). Follow the steps in order. Log in at
http://localhost:3100 as `admin` / `admin123`.

## Step 1 - Masters (Masters menu → each master → choose file → **Upload Excel**)

| File | Master | Expected message |
| --- | --- | --- |
| 01_Branch_Master.xlsx | Branch Master | 4 new master record(s) added |
| 02_Category_Master.xlsx | Category Master | 4 new master record(s) added |
| 03_Description_Master.xlsx | Description Master | 9 new master record(s) added |
| 04_PO_Client_Master.xlsx | PO Client Master | 4 new master record(s) added (PO-1004 is Inactive on purpose) |
| 05_Client_Cost_Center_Master.xlsx | Client / Cost Center | 4 new master record(s) added |

## Step 2 - Ledger Master (Transactions → Ledger Master, enter by hand, **Save Mapping**)

| Expense Head | Mapping | Active |
| --- | --- | --- |
| Computers | Taggable | Yes |
| Furniture & Fixtures | Taggable | Yes |
| Air Conditioners | Taggable | Yes |
| Office Equipment | Taggable | Yes |
| Repairs & Maintenance | Non Taggable | Yes |
| Software Licenses | Non Taggable | Yes |

## Step 3 - FA bulk upload (Transactions → Upload → Bulk Upload)

Upload **06_FA_Bulk_Upload.xlsx**. Expected:

- "11 bulk record(s) saved successfully. Some rows were skipped: Row 13 … | Row 14 …"
  (row 13 has no PO No, row 14 has amount 0 - both are deliberate error tests)
- FA Codes issued month-wise: APR20260001, APR20260002, MAY20260001 … SEP20260001
- INV-24004 (Repairs & Maintenance) and INV-24008 (Software Licenses) are **Non Taggable**
  ledgers, so they are plotted automatically and do not appear in the Qty Plotting list.
- The Qty Plotting list shows **9** pending invoices.

## Step 4 - Qty Plotting (Upload page → **Plot Qty**)

Enter Product, Quantity, Taggable and Product Amount (Unit Price fills itself). GST % 18.

| Invoice | Amount | Products to enter |
| --- | ---: | --- |
| INV-24001 | 2,50,000 | Laptop · 20 · Taggable · 2,50,000 |
| INV-24002 | 84,000 | Workstation Chair · 24 · Taggable · 84,000 |
| INV-24003 | 1,95,000 | Split AC 1.5 Ton · 4 · Taggable · 1,80,000 **+** Installation charges · 1 · Non Taggable · 15,000 |
| INV-24005 | 1,32,000 | Desktop · 6 · Taggable · 1,08,000 **+** Monitor · 6 · Taggable · 24,000 |
| INV-24006 | 60,000 | Office Desk · 10 · Taggable · 60,000 |
| INV-24007 | 75,000 | Projector · 3 · Taggable · 75,000 |
| INV-24009 | 52,000 | Lounge Sofa · 4 · Taggable · 52,000 |
| CN-24001 | -12,500 | Credit note: no products; enter **Against Invoice No = INV-24001** |
| INV-24010 | 48,000 | Video Conference Camera · 2 · Taggable · 48,000 |

Checks worth trying on the way:
- Save with Taggable not selected → "Please select Taggable or Non Taggable in row 1." (row turns red)
- Enter a total that does not match → "Qty Plotting total … must exactly match invoice amount …"
- CN-24001 without Against Invoice No → "For negative amount, Against Invoice No or Against Asset Code is required."

## Step 5 - LWM (Transactions → LWM → **Upload Excel**)

Upload **07_LWM_Tally.xlsx**. Expected comparison:

| Expense Head | FA Data | Tally | Difference | Status |
| --- | ---: | ---: | ---: | --- |
| Air Conditioners | 1,95,000 | 1,95,000 | 0 | Matched |
| Capital Work in Progress | 0 | 25,000 | -25,000 | Difference (only in Tally) |
| Computers | 3,69,500 | 3,69,500 | 0 | Matched (includes the -12,500 credit note) |
| Furniture & Fixtures | 1,96,000 | 1,96,000 | 0 | Matched |
| Office Equipment | 1,23,000 | 1,15,000 | 8,000 | Difference |
| Repairs & Maintenance | 45,000 | 45,000 | 0 | Matched |
| Software Licenses | 36,000 | 36,000 | 0 | Matched |

## Step 6 - Dashboard

After all plotting: Total FA **11**, Pending **0**, Completed **11**, Total Amount **9,64,500.00**,
Plotted **9,64,500.00**. Building-wise summary shows Whitefield Tower A, Koramangala,
Chennai OMR and Hitech City.

## Step 7 - FAMS Template (Reports → FAMS Template → Generate)

13 rows. Expected **Error Remark** (all other rows blank = OK):

| Invoice | Product | Error Remark |
| --- | --- | --- |
| INV-24003 | Installation charges | Asset Description not found in Description Master |
| INV-24004 | Repairs & Maintenance | Asset Description not found … · Expense Head not found in Category Master |
| INV-24007 | Projector | PO is inactive in PO Client Master |
| INV-24008 | Software Licenses | Asset Description not found … · Expense Head not found in Category Master |
| INV-24009 | Lounge Sofa | PO No not found in PO Client Master · Client As Per PMO not found … (PO No = BOQ) |
| CN-24001 | Computers (Credit Not/Reversal) | Asset Description not found in Description Master |
| INV-24010 | Video Conference Camera | PO No not found in PO Client Master · Client As Per PMO not found … |

## Step 8 - FA Data

- 11 records, 10 per page (page 2 has 1).
- **Export** gives 13 rows (one per product line); INV-24009 shows Client Name **Common area** (PO No BOQ).
- Try **Edit** on INV-24002: change Amount to 90,000 without changing products → error
  "Qty Plotting total (84,000.00) must exactly match FA amount (90,000.00)."
- Try **Delete** on any record → it disappears from FA Data, LWM and Dashboard totals.
