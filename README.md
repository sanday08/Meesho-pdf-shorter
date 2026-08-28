# Manifest — Shipping Label PDF Sorter

A small React app that reads a merged shipping-label + tax-invoice PDF
(Delhivery / Shadowfax / Valmo / Xpress Bees style labels, one shipment per
page), pulls out the key fields, lets you sort and review them by garment
size, and exports the result as JSON.

## What it extracts per page

- Customer name, address, city, state, pincode
- Courier, payment mode (Prepaid / COD), tracking number
- SKU, size, color, quantity, order number
- Purchase order no., invoice no., order date, invoice date
- GSTIN, seller name, invoice total

Extraction is done entirely in the browser with [pdf.js](https://mozilla.github.io/pdf.js/)
— no files are uploaded anywhere.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`), drop in
your PDF, and the app will parse it page by page.

## Using it

1. Drop or select the merged PDF.
2. Rows appear sorted by size (XS → S → M → L → XL → XXL, then numeric
   sizes, then anything unrecognized).
3. Every cell is editable — extraction is regex-based and reads straight
   from the PDF's text layer, so double-check a few rows against the
   original labels and fix anything that looks off before exporting.
4. Use the search box to filter by name, SKU, tracking number, city, etc.
5. Export:
   - **Download JSON (sorted by size)** — a flat array, sorted.
   - **Download grouped JSON** — an object keyed by size, e.g.
     `{ "S": [...], "M": [...], "L": [...] }`.

## Notes on accuracy

Label layouts vary between couriers and sellers, so the parser uses a set
of pattern-matching heuristics (looking for "Product Details", "Return
Code", "Purchase Order No.", known courier names, etc.) rather than a fixed
column layout. It's been tuned against Delhivery/Shadowfax/Valmo/Xpress
Bees style labels. If you feed it a very different label format, some
fields may come back blank — just fill them in directly in the table.

## Project structure

```
src/
  pdfParser.js   — PDF → per-page text lines → structured record
  sizeUtils.js   — size ordering / grouping helpers
  App.jsx        — UI: upload, table, search, export
  styles.css
```
