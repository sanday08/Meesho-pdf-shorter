// Reads a shipping-label + tax-invoice PDF (the kind produced by Delhivery,
// Shadowfax, Valmo, Xpress Bees, etc.) and pulls one structured record per
// page. Each page in these merged PDFs is one shipment.

const COURIERS = [
  'ValmoPlus',
  'Valmo',
  'Delhivery',
  'Shadowfax',
  'Xpress Bees',
  'Ecom Express',
  'Bluedart',
  'Blue Dart',
  'DTDC',
  'Ekart',
  'Amazon Shipping',
  'Shree Maruti',
  'India Post',
];

const SIZE_TOKEN = 'XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL|FREE\\s?SIZE|\\d{1,2}';

const PRODUCT_ROW_RE = new RegExp(
  `([A-Za-z0-9&/.'()\\-\\s]+?)\\s+(${SIZE_TOKEN})\\s+(\\d+)\\s+([A-Za-z\\s]+|NA)\\s+(\\d{10,25}_\\d+)`,
  'i'
);

/** Group a page's text items into visual lines using their y-position. */
async function getPageLines(page) {
  const content = await page.getTextContent();
  const items = content.items.filter((i) => i.str && i.str.trim());

  const buckets = [];
  items.forEach((item) => {
    const y = item.transform[5];
    let bucket = buckets.find((b) => Math.abs(b.y - y) <= 2.5);
    if (!bucket) {
      bucket = { y, items: [] };
      buckets.push(bucket);
    }
    bucket.items.push(item);
  });

  buckets.sort((a, b) => b.y - a.y);

  return buckets.map((b) =>
    b.items
      .sort((a, c) => a.transform[4] - c.transform[4])
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  ).filter(Boolean);
}

function firstMatch(lines, testRe) {
  return lines.findIndex((l) => testRe.test(l));
}

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu & Kashmir',
  'Jammu and Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry', 'Daman and Diu',
  'Dadra and Nagar Haveli'
];

function extractAddressBlock(lines) {
  const out = { customerName: '', address: '', city: '', state: '', pincode: '' };

  // Locate the Customer Address header
  let idx = lines.findIndex((l) => /^Customer\s*(?:Name\s*&?\s*)?Address\b/i.test(l));
  if (idx === -1) {
    idx = lines.findIndex((l) => /\bCustomer\s*Address\b/i.test(l));
  }
  if (idx === -1) {
    idx = lines.findIndex((l) => /^(?:Deliver(?:y)?\s*Address|Ship\s*To)\b/i.test(l));
  }

  const INVALID_NAME_RE = /^(?:Return Code|Product Details|Purchase Order|Sold by|Seller|Invoice|GSTIN|Prepaid|COD|If undelivered|Phone|Mobile|Tel|Order|HAWB|AWB|Tracking|Delhivery|Shadowfax|Valmo|Xpress|Bluedart|DTDC|Ekart)/i;

  if (idx !== -1) {
    // Determine the customer name line (strictly from the line below the header, or cleaned inline if explicit)
    let candidateName = '';
    const headerLine = lines[idx].trim();
    
    // If header is strictly like "Customer Address : John Doe", extract after colon
    const colonMatch = headerLine.match(/^(?:Customer\s*(?:Name\s*&?\s*)?Address|Deliver(?:y)?\s*Address|Ship\s*To)\s*[:\-]\s*([A-Za-z\s.]{3,40})$/i);
    if (colonMatch && !INVALID_NAME_RE.test(colonMatch[1].trim())) {
      candidateName = colonMatch[1].trim();
    }

    let startLine = idx + 1;
    if (!candidateName && lines[startLine]) {
      const nextLine = lines[startLine].trim().replace(/^(?:Name|Customer Name|Customer)\s*[:\-]\s*/i, '');
      if (!INVALID_NAME_RE.test(nextLine)) {
        candidateName = nextLine;
      }
      startLine++;
    }

    out.customerName = candidateName;

    // Collect address lines up to stopping sections
    const parts = [];
    for (let i = startLine; i < lines.length && i < startLine + 8; i++) {
      const l = lines[i].trim();
      if (!l || /^(?:If undelivered|Return Code|Product Details|Purchase Order|Sold by|Seller\s*:|Invoice|GSTIN|Description|Total)/i.test(l)) {
        break;
      }
      parts.push(l);

      // Check for 6-digit Indian PIN code on this address line
      const pinMatch = l.match(/\b(\d{6})\b/);
      if (pinMatch) {
        out.pincode = pinMatch[1];

        // 1. Check if an Indian state name is in this line
        for (const st of INDIAN_STATES) {
          const stRe = new RegExp('\\b' + st.replace('&', '(?:&|and)') + '\\b', 'i');
          if (stRe.test(l)) {
            out.state = st;
            break;
          }
        }

        // 2. Parse City & State from segment before pincode (e.g. "Surat, Gujarat, 395006" or "Surat, Gujarat - 395006")
        const beforePin = l.substring(0, pinMatch.index).replace(/[,\-\s]+$/, '').trim();
        if (beforePin) {
          const segments = beforePin.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
          if (segments.length >= 2) {
            out.city = segments[segments.length - 2];
            if (!out.state) out.state = segments[segments.length - 1];
          } else if (segments.length === 1) {
            if (!out.city) {
              // If single segment is not the state itself, it's the city
              if (!INDIAN_STATES.some(st => st.toLowerCase() === segments[0].toLowerCase())) {
                out.city = segments[0];
              }
            }
          }
        }
      }
    }
    out.address = parts.join(', ');
  }

  // Fallback for state if detected anywhere in address text
  if (!out.state && out.address) {
    for (const st of INDIAN_STATES) {
      const stRe = new RegExp('\\b' + st.replace('&', '(?:&|and)') + '\\b', 'i');
      if (stRe.test(out.address)) {
        out.state = st;
        break;
      }
    }
  }

  return out;
}

function extractPaymentMode(fullText) {
  if (/Prepaid/i.test(fullText)) return 'Prepaid';
  if (/\bCOD\b/i.test(fullText)) return 'COD';
  if (/Check the payable amount/i.test(fullText)) return 'COD';
  return '';
}

function extractCourier(fullText) {
  for (const c of COURIERS) {
    const re = new RegExp('\\b' + c.replace(/\s+/g, '\\s+') + '\\b', 'i');
    if (re.test(fullText)) return c;
  }
  return '';
}

function extractTrackingNumber(lines) {
  const idx = firstMatch(lines, /Return Code/i);
  if (idx === -1) return '';
  for (let i = idx + 1; i <= Math.min(idx + 4, lines.length - 1); i++) {
    const raw = lines[i];
    if (!raw) continue;
    if (/,\s*\d{3,}/.test(raw)) continue; // this is the return-code value line (pincode,code)
    const candidate = raw.replace(/\s+/g, '');
    if (/^[A-Za-z0-9]{8,25}$/.test(candidate)) return candidate;
  }
  return '';
}

function extractProductRow(lines, fullText) {
  const out = { sku: '', size: '', qty: '', color: '', orderNo: '' };
  const idx = firstMatch(lines, /Product Details/i);
  const searchLines = idx !== -1 ? lines.slice(idx + 1, idx + 6) : lines;
  for (const l of searchLines) {
    const m = l.match(PRODUCT_ROW_RE);
    if (m) {
      out.sku = m[1].trim();
      out.size = m[2].trim().toUpperCase().replace(/\s+/g, '');
      out.qty = m[3].trim();
      out.color = m[4].trim();
      out.orderNo = m[5].trim();
      return out;
    }
  }
  const m = fullText.match(PRODUCT_ROW_RE);
  if (m) {
    out.sku = m[1].trim();
    out.size = m[2].trim().toUpperCase().replace(/\s+/g, '');
    out.qty = m[3].trim();
    out.color = m[4].trim();
    out.orderNo = m[5].trim();
  }
  return out;
}

function extractInvoiceMeta(lines, fullText) {
  const out = { purchaseOrderNo: '', invoiceNo: '', orderDate: '', invoiceDate: '' };
  const idx = firstMatch(lines, /Purchase Order No\.?/i);
  const rowRe = /(\d{10,25})\s+(\S+)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})/;
  if (idx !== -1) {
    for (let i = idx; i <= Math.min(idx + 4, lines.length - 1); i++) {
      const m = lines[i].match(rowRe);
      if (m) {
        out.purchaseOrderNo = m[1];
        out.invoiceNo = m[2];
        out.orderDate = m[3];
        out.invoiceDate = m[4];
        return out;
      }
    }
  }
  const m = fullText.match(rowRe);
  if (m) {
    out.purchaseOrderNo = m[1];
    out.invoiceNo = m[2];
    out.orderDate = m[3];
    out.invoiceDate = m[4];
  }
  return out;
}

function extractTotal(fullText) {
  const matches = [...fullText.matchAll(/Total\s+Rs\.?([\d.,]+)\s+Rs\.?([\d.,]+)/gi)];
  if (!matches.length) return '';
  return matches[matches.length - 1][2];
}

function get(fullText, re) {
  const m = fullText.match(re);
  return m ? m[1].trim() : '';
}

function parseRecordFromLines(lines, pageNum) {
  const fullText = lines.join('\n');

  const addr = extractAddressBlock(lines);
  const product = extractProductRow(lines, fullText);
  const invoiceMeta = extractInvoiceMeta(lines, fullText);

  return {
    id: `page-${pageNum}`,
    page: pageNum,
    customerName: addr.customerName,
    address: addr.address,
    city: addr.city,
    state: addr.state,
    pincode: addr.pincode,
    courier: extractCourier(fullText),
    paymentMode: extractPaymentMode(fullText),
    trackingNumber: extractTrackingNumber(lines),
    sku: product.sku,
    size: product.size,
    qty: product.qty,
    color: product.color,
    orderNo: product.orderNo,
    purchaseOrderNo: invoiceMeta.purchaseOrderNo,
    invoiceNo: invoiceMeta.invoiceNo,
    orderDate: invoiceMeta.orderDate,
    invoiceDate: invoiceMeta.invoiceDate,
    gstin: get(fullText, /GSTIN\s*-\s*(\S+)/i),
    soldBy: get(fullText, /Sold by\s*:\s*(.+)/i),
    totalAmount: extractTotal(fullText),
  };
}

/**
 * Parse an uploaded PDF File/Blob into an array of shipment records,
 * one per page. Accepts an ArrayBuffer so callers can reuse the same
 * buffer for both parsing and re-export without reading the file twice.
 */
export async function parsePdfFile(arrayBuffer, onProgress) {
  if (!window.pdfjsLib) {
    throw new Error('pdf.js did not load. Check your internet connection and reload.');
  }
  // pdf.js transfers (detaches) the ArrayBuffer when it posts it to its worker.
  // We pass a copy so the caller's buffer stays intact for re-export with pdf-lib.
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

  const records = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const lines = await getPageLines(page);
    if (lines.length) {
      records.push(parseRecordFromLines(lines, pageNum));
    }
    if (onProgress) onProgress(pageNum, pdf.numPages);
  }
  return records;
}
