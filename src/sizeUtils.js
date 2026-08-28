export const SIZE_ORDER = [
  'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL', '4XL', '5XL', 'FREESIZE',
];

export function sizeRank(sizeRaw) {
  const size = (sizeRaw || '').toUpperCase().replace(/\s+/g, '');
  if (!size) return 9999;
  const idx = SIZE_ORDER.indexOf(size);
  if (idx !== -1) return idx;
  if (/^\d+$/.test(size)) return 100 + parseInt(size, 10); // numeric sizes sort after alpha sizes
  return 500; // unrecognized label, sorts near the end but before "unknown"
}

export function sortRecordsBySize(records) {
  return [...records].sort((a, b) => {
    const r = sizeRank(a.size) - sizeRank(b.size);
    if (r !== 0) return r;
    return (a.customerName || '').localeCompare(b.customerName || '');
  });
}

export function sortRecordsBySku(records) {
  return [...records].sort((a, b) => {
    const skuCmp = (a.sku || '').localeCompare(b.sku || '');
    if (skuCmp !== 0) return skuCmp;
    return (a.customerName || '').localeCompare(b.customerName || '');
  });
}

export function groupBySize(records) {
  const groups = {};
  records.forEach((r) => {
    const key = r.size || 'UNKNOWN';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  const orderedKeys = Object.keys(groups).sort((a, b) => sizeRank(a) - sizeRank(b));
  const ordered = {};
  orderedKeys.forEach((k) => {
    ordered[k] = groups[k];
  });
  return ordered;
}

export const SKU_PREFIX_KEYWORDS = [
  'ORBIT',
  'ORBT',
  'RTFN',
  'RTN',
  'QRP',
  'TTF',
  'VDT',
  'VD',
  'DD',
  'RC',
  'RF',
  'TC',
  'SAC',
];

const PREFIX_PATTERN = SKU_PREFIX_KEYWORDS.slice().sort((a, b) => b.length - a.length).join('|');
const PREFIX_REGEX = new RegExp(`^(?:(?:${PREFIX_PATTERN})[-_ ]*)+`, 'i');

/**
 * Normalizes an SKU by:
 * 1. Removing vendor prefixes: ORBIT, ORBT, QRP, RTFN, RTN, TTF, VD, VDT, DD, RC, RF, TC, SAC (case-insensitive)
 * 2. Removing '001', '002', '003', '004', '005', '006', '007', '008', '009'
 * 3. Cleaning leftover delimiters
 */
export function normalizeSku(rawSku) {
  if (!rawSku) return 'UNKNOWN';
  let sku = String(rawSku).trim();

  // 1. Ignore prefixes with optional hyphens/spaces/underscores
  sku = sku.replace(PREFIX_REGEX, '');

  // 2. Ignore 001, 002, 003, 004, 005, 006, 007, 008, 009
  sku = sku.replace(/00[1-9]/g, '');

  // 3. Clean up leftover duplicate/leading/trailing hyphens or underscores
  sku = sku.replace(/[-_ ]{2,}/g, '-').replace(/^[-_ ]+|[-_ ]+$/g, '');

  return sku || rawSku.trim() || 'UNKNOWN';
}

/**
 * Groups shipment records by their normalized base SKU and aggregates:
 * - Total orders / shipments
 * - Total quantity
 * - Total amount
 * - Size breakdown (e.g. S: 4, M: 8)
 * - List of original raw SKUs mapping to this base SKU
 */
export function groupRecordsByBaseSku(records) {
  const groups = {};

  records.forEach((r) => {
    const baseSku = normalizeSku(r.sku);
    if (!groups[baseSku]) {
      groups[baseSku] = {
        baseSku,
        rawSkus: new Set(),
        totalOrders: 0,
        totalQty: 0,
        totalAmount: 0,
        sizeBreakdown: {},
        records: [],
      };
    }

    const g = groups[baseSku];
    if (r.sku) g.rawSkus.add(r.sku);
    g.totalOrders += 1;

    const qty = parseInt(r.qty, 10) || 1;
    g.totalQty += qty;

    const amt = parseFloat(String(r.totalAmount || '0').replace(/,/g, '')) || 0;
    g.totalAmount += amt;

    const sizeKey = r.size || 'UNKNOWN';
    g.sizeBreakdown[sizeKey] = (g.sizeBreakdown[sizeKey] || 0) + qty;

    g.records.push(r);
  });

  return Object.values(groups).map((g) => ({
    ...g,
    rawSkus: Array.from(g.rawSkus),
    sortedSizes: Object.entries(g.sizeBreakdown).sort((a, b) => sizeRank(a[0]) - sizeRank(b[0])),
  }));
}

