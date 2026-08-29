import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { parsePdfFile } from './pdfParser.js';
import { sortRecordsBySize, sortRecordsBySku, groupBySize, groupRecordsByBaseSku, normalizeSku } from './sizeUtils.js';

const PASSKEY_CONSTANT = 'Sanday@89';
const RECENT_FILES_KEY = 'manifest_recent_files_v1';

const GITHUB_OWNER = 'sanday08';
const GITHUB_REPO = 'Meesho-pdf-shorter';
// IMPORTANT: Replace this placeholder with your Personal Access Token
// WARNING: If this repo is public, anyone can steal this token!
const GITHUB_PAT = 'YOUR_GITHUB_PAT_HERE';

async function fetchRecentFiles() {
  try {
    const promises = Array.from({ length: 7 }, (_, i) => {
      const fileSlot = `0${i + 1}.json`;
      return fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/src/${fileSlot}`, {
        headers: GITHUB_PAT !== 'YOUR_GITHUB_PAT_HERE' ? {
          'Authorization': `token ${GITHUB_PAT}`,
          'Accept': 'application/vnd.github.v3+json'
        } : { 'Accept': 'application/vnd.github.v3+json' }
      }).then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.content) {
            const decoded = decodeURIComponent(escape(atob(data.content)));
            if (decoded.trim()) {
              return { slot: fileSlot, sha: data.sha, data: JSON.parse(decoded) };
            }
            return { slot: fileSlot, sha: data.sha, data: null };
          }
          return { slot: fileSlot, sha: null, data: null };
        }).catch(() => ({ slot: fileSlot, sha: null, data: null }));
    });
    return await Promise.all(promises);
  } catch (err) {
    console.error('Failed to fetch recent files:', err);
    return [];
  }
}

async function saveRecentFile(fileName, records, currentSlots) {
  try {
    const newEntry = {
      id: 'file-' + Date.now(),
      fileName: fileName || 'Untitled.pdf',
      timestamp: new Date().toISOString(),
      dateFormatted: new Date().toLocaleString(),
      recordCount: records.length,
      records: records.map(({ id: _, ...rest }, i) => ({ id: `page-${i + 1}`, ...rest })),
    };

    // Find first empty slot, or the oldest slot to overwrite
    let targetSlot = currentSlots.find(s => !s.data);
    if (!targetSlot) {
      targetSlot = currentSlots.reduce((oldest, current) => {
        if (!oldest.data) return current;
        if (!current.data) return oldest;
        return new Date(oldest.data.timestamp) < new Date(current.data.timestamp) ? oldest : current;
      });
    }

    // fallback if somehow undefined
    if (!targetSlot) targetSlot = { slot: '01.json', sha: null, data: null };

    const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(newEntry, null, 2))));
    
    if (GITHUB_PAT === 'YOUR_GITHUB_PAT_HERE') {
      console.warn("GitHub PAT is missing, cannot save to repository. Simulating save locally.");
      const updated = [...currentSlots];
      const idx = updated.findIndex(s => s.slot === targetSlot.slot);
      if (idx !== -1) updated[idx] = { ...updated[idx], data: newEntry };
      return updated;
    }

    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/src/${targetSlot.slot}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Update ${targetSlot.slot} with new uploaded file`,
        content: contentBase64,
        sha: targetSlot.sha || undefined
      })
    });

    if (!res.ok) throw new Error('Failed to commit to GitHub');
    const resultData = await res.json();
    
    const updated = [...currentSlots];
    const idx = updated.findIndex(s => s.slot === targetSlot.slot);
    if (idx !== -1) {
      updated[idx] = { slot: targetSlot.slot, sha: resultData.content.sha, data: newEntry };
    }
    return updated;
  } catch (err) {
    console.error('Failed to save recent file:', err);
    return currentSlots;
  }
}

const COLUMNS = [
  { key: 'size', label: 'Size', width: '64px' },
  { key: 'sku', label: 'SKU', width: '190px' },
  { key: 'color', label: 'Color', width: '110px' },
  { key: 'qty', label: 'Qty', width: '52px' },
  { key: 'customerName', label: 'Customer', width: '150px' },
  { key: 'city', label: 'City', width: '120px' },
  { key: 'state', label: 'State', width: '120px' },
  { key: 'courier', label: 'Courier', width: '100px' },
  { key: 'paymentMode', label: 'Payment', width: '80px' },
  { key: 'trackingNumber', label: 'Tracking No.', width: '150px' },
  { key: 'orderNo', label: 'Order No.', width: '180px' },
  { key: 'invoiceNo', label: 'Invoice No.', width: '110px' },
  { key: 'totalAmount', label: 'Total (₹)', width: '90px' },
];

function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Custom multi-select checkbox dropdown */
function MultiSelect({ id, label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (val) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(next);
  };

  const clearAll = (e) => { e.stopPropagation(); onChange(new Set()); };
  const selectAll = (e) => { e.stopPropagation(); onChange(new Set(options)); };

  const isActive = selected.size > 0;

  const buttonText = () => {
    if (!isActive) return `All ${label}s`;
    const arr = [...selected];
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr.join(', ');
    return `${arr.slice(0, 2).join(', ')} +${arr.length - 2}`;
  };

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <button
        id={id}
        type="button"
        className={`ms-btn ${isActive ? 'ms-btn-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ms-btn-text">{buttonText()}</span>
        {isActive && <span className="ms-badge">{selected.size}</span>}
        <span className="ms-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="ms-dropdown" role="listbox" aria-multiselectable="true">
          <div className="ms-dropdown-header">
            <span className="ms-dropdown-title">{label}</span>
            <div className="ms-header-actions">
              <button type="button" className="ms-action-link" onClick={selectAll}>All</button>
              <span className="ms-sep">·</span>
              <button type="button" className="ms-action-link" onClick={clearAll}>None</button>
            </div>
          </div>
          <div className="ms-options">
            {options.map((opt) => (
              <label key={opt} className={`ms-option ${selected.has(opt) ? 'ms-option-checked' : ''}`}>
                <input
                  type="checkbox"
                  className="ms-checkbox"
                  checked={selected.has(opt)}
                  onChange={() => toggle(opt)}
                />
                <span className="ms-option-label">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | parsing | done | error
  const [progress, setProgress] = useState({ page: 0, total: 0 });
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('manifest'); // 'manifest' | 'skuSummary' | 'history'
  const [skuSortMode, setSkuSortMode] = useState('orders'); // 'orders' | 'qty' | 'sku'
  const [skuSearchQuery, setSkuSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState('sku'); // 'sku' | 'size'
  const [filterSizes, setFilterSizes] = useState(new Set()); // empty Set = all
  const [filterSkus, setFilterSkus] = useState(new Set());   // empty Set = all
  const [fileName, setFileName] = useState('');
  const [rawBuffer, setRawBuffer] = useState(null); // original PDF bytes for re-export
  const [recentFiles, setRecentFiles] = useState([]);
  const [recentFilesSlots, setRecentFilesSlots] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    setIsLoadingHistory(true);
    fetchRecentFiles().then(slots => {
      setRecentFilesSlots(slots);
      const files = slots.map(s => s.data).filter(Boolean);
      files.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRecentFiles(files);
    }).finally(() => setIsLoadingHistory(false));
  }, []);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passkeyInput, setPasskeyInput] = useState('');
  const [passkeyError, setPasskeyError] = useState('');
  const [expandedPreviewId, setExpandedPreviewId] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('manifest-theme');
      if (saved) return saved;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  });
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('manifest-theme', theme);
    } catch (_) {}
  }, [theme]);

  const handleUnlockHistory = (e) => {
    e?.preventDefault();
    if (passkeyInput === PASSKEY_CONSTANT) {
      setIsUnlocked(true);
      setPasskeyError('');
      setPasskeyInput('');
    } else {
      setPasskeyError('Incorrect passkey. Please try again.');
    }
  };

  const handleLockHistory = () => {
    setIsUnlocked(false);
    setPasskeyInput('');
    setPasskeyError('');
  };

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to hide stored recent files locally? (This does not delete them from GitHub)')) {
      setRecentFiles([]);
    }
  };

  const loadRecentFile = (fileItem) => {
    setRecords(fileItem.records || []);
    setFileName(fileItem.fileName);
    setRawBuffer(null);
    setStatus('done');
    setActiveTab('manifest');
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setStatus('parsing');
    setError('');
    setProgress({ page: 0, total: 0 });
    try {
      const buf = await file.arrayBuffer();
      setRawBuffer(buf);
      const parsed = await parsePdfFile(buf, (page, total) => setProgress({ page, total }));
      setRecords(parsed);
      setStatus('done');
      // Save file to GitHub repository
      const updatedSlots = await saveRecentFile(file.name, parsed, recentFilesSlots);
      setRecentFilesSlots(updatedSlots);
      const files = updatedSlots.map(s => s.data).filter(Boolean);
      files.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRecentFiles(files);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Something went wrong while reading the PDF.');
      setStatus('error');
    }
  };

  const onInputChange = (e) => handleFile(e.target.files?.[0]);

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') handleFile(file);
  };

  const updateField = (id, key, value) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  };

  const sorted = useMemo(
    () => sortMode === 'sku' ? sortRecordsBySku(records) : sortRecordsBySize(records),
    [records, sortMode]
  );

  const SIZE_ORDER_LOCAL = ['XXS','XS','S','M','L','XL','XXL','XXXL','3XL','4XL','5XL','FREESIZE'];

  const uniqueSizes = useMemo(() => {
    const s = [...new Set(records.map((r) => r.size).filter(Boolean))];
    return s.sort((a, b) => {
      const ia = SIZE_ORDER_LOCAL.indexOf(a.toUpperCase());
      const ib = SIZE_ORDER_LOCAL.indexOf(b.toUpperCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [records]);

  const uniqueSkus = useMemo(
    () => [...new Set(records.map((r) => r.sku).filter(Boolean))].sort(),
    [records]
  );

  const filtered = useMemo(() => {
    let rows = sorted;
    if (filterSizes.size) rows = rows.filter((r) => filterSizes.has(r.size));
    if (filterSkus.size)  rows = rows.filter((r) => filterSkus.has(r.sku));
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((r) =>
        Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))
      );
    }
    return rows;
  }, [sorted, query, filterSizes, filterSkus]);

  const hasActiveFilters = !!(filterSizes.size || filterSkus.size || query.trim());
  const clearFilters = () => { setFilterSizes(new Set()); setFilterSkus(new Set()); setQuery(''); };

  const sizeCounts = useMemo(() => {
    const groups = groupBySize(records);
    return Object.entries(groups).map(([size, items]) => ({
      size,
      count: items.reduce((sum, r) => sum + (parseInt(r.qty, 10) || 1), 0),
    }));
  }, [records]);

  // SKU Summary calculations (ignoring rf-, rc-, dd- and 001-009)
  const skuSummaryList = useMemo(() => {
    const list = groupRecordsByBaseSku(records);
    return list.sort((a, b) => {
      if (skuSortMode === 'orders') {
        const diff = b.totalOrders - a.totalOrders;
        if (diff !== 0) return diff;
        return a.baseSku.localeCompare(b.baseSku);
      }
      if (skuSortMode === 'qty') {
        const diff = b.totalQty - a.totalQty;
        if (diff !== 0) return diff;
        return a.baseSku.localeCompare(b.baseSku);
      }
      return a.baseSku.localeCompare(b.baseSku);
    });
  }, [records, skuSortMode]);

  const filteredSkuSummary = useMemo(() => {
    if (!skuSearchQuery.trim()) return skuSummaryList;
    const q = skuSearchQuery.toLowerCase();
    return skuSummaryList.filter((item) =>
      item.baseSku.toLowerCase().includes(q) ||
      item.rawSkus.some((s) => s.toLowerCase().includes(q)) ||
      item.sortedSizes.some(([sz]) => sz.toLowerCase().includes(q))
    );
  }, [skuSummaryList, skuSearchQuery]);

  const skuTotals = useMemo(() => {
    return skuSummaryList.reduce(
      (acc, cur) => {
        acc.totalOrders += cur.totalOrders;
        acc.totalQty += cur.totalQty;
        acc.totalAmount += cur.totalAmount;
        return acc;
      },
      { totalOrders: 0, totalQty: 0, totalAmount: 0 }
    );
  }, [skuSummaryList]);

  const exportSkuSummaryJson = () => {
    const payload = skuSummaryList.map(({ records: _, ...item }) => item);
    download('sku_order_summary.json', JSON.stringify(payload, null, 2));
  };

  const exportSkuSummaryCsv = () => {
    const headers = ['Base SKU (Normalized)', 'Original SKUs', 'Size Breakdown', 'Total Orders', 'Total Qty', 'Total Amount (INR)'];
    const rows = skuSummaryList.map((item) => [
      `"${item.baseSku.replace(/"/g, '""')}"`,
      `"${item.rawSkus.join(', ').replace(/"/g, '""')}"`,
      `"${item.sortedSizes.map(([s, q]) => `${s}:${q}`).join(' | ').replace(/"/g, '""')}"`,
      item.totalOrders,
      item.totalQty,
      item.totalAmount.toFixed(2),
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    download('sku_order_summary.csv', csvContent, 'text/csv;charset=utf-8;');
  };

  const exportFlatJson = () => {
    const payload = sorted.map(({ id, page, ...rest }) => rest);
    const label = sortMode === 'sku' ? 'by_sku' : 'by_size';
    download(`shipments_sorted_${label}.json`, JSON.stringify(payload, null, 2));
  };

  const exportGroupedJson = () => {
    const groups = groupBySize(records);
    const payload = {};
    Object.entries(groups).forEach(([size, items]) => {
      payload[size] = items.map(({ id, page, ...rest }) => rest);
    });
    download('shipments_grouped_by_size.json', JSON.stringify(payload, null, 2));
  };

  const downloadSortedPdf = async () => {
    if (!rawBuffer) return;
    try {
      const srcPdf = await PDFDocument.load(rawBuffer);
      const outPdf = await PDFDocument.create();
      // sorted has the records in display order; each record.page is 1-indexed
      const pageIndices = sorted.map((r) => r.page - 1);
      const copied = await outPdf.copyPages(srcPdf, pageIndices);
      copied.forEach((p) => outPdf.addPage(p));
      const bytes = await outPdf.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const label = sortMode === 'sku' ? 'by_sku' : 'by_size';
      a.download = `shipments_sorted_${label}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed: ' + err.message);
    }
  };

  const reset = () => {
    setRecords([]);
    setStatus('idle');
    setFileName('');
    setError('');
    setRawBuffer(null);
    setFilterSizes(new Set());
    setFilterSkus(new Set());
    setQuery('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <h1>Manifest</h1>
            <p className="brand-sub">Shipping-label PDF reader &amp; size sorter</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab((t) => (t === 'history' ? 'manifest' : 'history'))}
            title="System Diagnostics & Audit"
          >
            <span>⚙️</span>
            <span>Diagnostics</span>
          </button>
          {records.length > 0 && (
            <>
              <span className="file-chip">{fileName} · {records.length} shipment{records.length !== 1 ? 's' : ''}</span>
              <button className="btn btn-ghost" onClick={reset}>Start over</button>
            </>
          )}
          <button
            className="btn btn-theme"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle light/dark theme"
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      <main>
        {status !== 'done' || records.length === 0 ? (
          <section
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={onInputChange}
            />
            <div className="dropzone-inner">
              <div className="tag-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="40" height="40">
                  <path d="M6 22 L22 6 L42 6 L42 26 L26 42 Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
                  <circle cx="33" cy="15" r="3.2" fill="currentColor" />
                </svg>
              </div>
              {status === 'parsing' ? (
                <>
                  <h2>Reading {fileName}…</h2>
                  <p className="dropzone-hint">
                    {progress.total ? `Page ${progress.page} of ${progress.total}` : 'Opening PDF…'}
                  </p>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: progress.total ? `${(progress.page / progress.total) * 100}%` : '10%' }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <h2>Drop a merged shipping-label PDF here</h2>
                  <p className="dropzone-hint">
                    Or click to browse. Each page (label + tax invoice) becomes one row — SKU, size, color, customer, courier and totals are pulled out automatically.
                  </p>
                  <button className="btn btn-primary" type="button">Choose PDF</button>
                </>
              )}
              {status === 'error' && <p className="error-text">{error}</p>}
            </div>
          </section>
        ) : (
          <>
            {/* View Tabs */}
            <div className="view-tabs">
              <button
                className={`view-tab-btn ${activeTab === 'manifest' ? 'view-tab-active' : ''}`}
                onClick={() => setActiveTab('manifest')}
              >
                <span className="tab-icon">📋</span>
                <span>Shipments Manifest</span>
                <span className="tab-badge">{records.length}</span>
              </button>
              <button
                className={`view-tab-btn ${activeTab === 'skuSummary' ? 'view-tab-active' : ''}`}
                onClick={() => setActiveTab('skuSummary')}
              >
                <span className="tab-icon">📊</span>
                <span>SKU Wise Total Orders</span>
                <span className="tab-badge">{skuSummaryList.length}</span>
              </button>
              <button
                className={`view-tab-btn ${activeTab === 'history' ? 'view-tab-active' : ''}`}
                onClick={() => setActiveTab('history')}
                title="System Configuration & Diagnostics"
              >
                <span className="tab-icon">⚙️</span>
                <span>Diagnostics &amp; Logs</span>
                {isUnlocked && <span className="tab-badge">{recentFiles.length}</span>}
              </button>
            </div>

            {activeTab === 'manifest' ? (
              <>
                <section className="summary-row">
                  {sizeCounts.map(({ size, count }) => (
                    <div className="size-tag" key={size}>
                      <span className="size-tag-label">{size}</span>
                      <span className="size-tag-count">{count}</span>
                    </div>
                  ))}
                </section>

                <section className="toolbar">
                  <div className="toolbar-row">
                    <input
                      className="search"
                      placeholder="Search name, SKU, tracking no, city…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="sort-toggle" role="group" aria-label="Sort order">
                      <button
                        className={`btn btn-sort ${sortMode === 'size' ? 'btn-sort-active' : ''}`}
                        onClick={() => setSortMode('size')}
                        title="Sort by garment size (XS → XL)"
                      >
                        Sort: Size
                      </button>
                      <button
                        className={`btn btn-sort ${sortMode === 'sku' ? 'btn-sort-active' : ''}`}
                        onClick={() => setSortMode('sku')}
                        title="Sort alphabetically by SKU"
                      >
                        Sort: SKU
                      </button>
                    </div>
                    <div className="toolbar-actions">
                      <button className="btn btn-secondary" onClick={exportGroupedJson}>
                        Download grouped JSON
                      </button>
                      <button className="btn btn-secondary" onClick={exportFlatJson}>
                        Download JSON
                      </button>
                      <button className="btn btn-primary" onClick={downloadSortedPdf}>
                        ⬇ Download PDF (sorted)
                      </button>
                    </div>
                  </div>

                  <div className="filter-row">
                    <span className="filter-label">Filter:</span>

                    <MultiSelect
                      id="filter-size"
                      label="Size"
                      options={uniqueSizes}
                      selected={filterSizes}
                      onChange={setFilterSizes}
                    />

                    <MultiSelect
                      id="filter-sku"
                      label="SKU"
                      options={uniqueSkus}
                      selected={filterSkus}
                      onChange={setFilterSkus}
                    />

                    {hasActiveFilters && (
                      <button className="btn btn-ghost filter-clear" onClick={clearFilters}>
                        ✕ Clear all
                      </button>
                    )}
                    <span className="filter-count">
                      {filtered.length} of {records.length} shipment{records.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </section>

                <section className="table-wrap">
                  <table className="manifest-table">
                    <thead>
                      <tr>
                        <th className="row-num">#</th>
                        {COLUMNS.map((c) => (
                          <th key={c.key} style={{ minWidth: c.width }}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r, i) => (
                        <tr key={r.id}>
                          <td className="row-num">{i + 1}</td>
                          {COLUMNS.map((c) => (
                            <td key={c.key}>
                              <input
                                className={`cell-input ${c.key === 'size' ? 'cell-size' : ''}`}
                                value={r[c.key] ?? ''}
                                onChange={(e) => updateField(r.id, c.key, e.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={COLUMNS.length + 1} className="empty-row">
                            {hasActiveFilters
                              ? 'No shipments match the active filters.'
                              : 'No shipments found.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              </>
            ) : activeTab === 'skuSummary' ? (
              /* SKU Summary View */
              <div className="sku-summary-view">
                <div className="sku-stats-grid">
                  <div className="sku-stat-card">
                    <span className="sku-stat-label">Unique Base SKUs</span>
                    <span className="sku-stat-val">{skuSummaryList.length}</span>
                  </div>
                  <div className="sku-stat-card">
                    <span className="sku-stat-label">Total Orders (Shipments)</span>
                    <span className="sku-stat-val">{skuTotals.totalOrders}</span>
                  </div>
                  <div className="sku-stat-card">
                    <span className="sku-stat-label">Total Units (Quantity)</span>
                    <span className="sku-stat-val">{skuTotals.totalQty}</span>
                  </div>
                  <div className="sku-stat-card">
                    <span className="sku-stat-label">Total Value</span>
                    <span className="sku-stat-val">₹{skuTotals.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="sku-summary-banner">
                  <span className="banner-tag">Normalized Rule</span>
                  <span>Prefixes (<code>ORBIT</code>, <code>ORBT</code>, <code>QRP</code>, <code>RTFN</code>, <code>RTN</code>, <code>TTF</code>, <code>VDT</code>, <code>VD</code>, <code>DD</code>, <code>RC</code>, <code>RF</code>) and all digits/numbers are ignored and merged into their base SKU.</span>
                </div>

                <section className="toolbar">
                  <div className="toolbar-row">
                    <input
                      className="search"
                      placeholder="Search Base SKU, Original SKU, or Size…"
                      value={skuSearchQuery}
                      onChange={(e) => setSkuSearchQuery(e.target.value)}
                    />
                    <div className="sort-toggle" role="group" aria-label="Sort SKU Summary">
                      <button
                        className={`btn btn-sort ${skuSortMode === 'orders' ? 'btn-sort-active' : ''}`}
                        onClick={() => setSkuSortMode('orders')}
                        title="Sort by highest total orders"
                      >
                        Sort: Orders (High-Low)
                      </button>
                      <button
                        className={`btn btn-sort ${skuSortMode === 'qty' ? 'btn-sort-active' : ''}`}
                        onClick={() => setSkuSortMode('qty')}
                        title="Sort by highest total quantity"
                      >
                        Sort: Qty (High-Low)
                      </button>
                      <button
                        className={`btn btn-sort ${skuSortMode === 'sku' ? 'btn-sort-active' : ''}`}
                        onClick={() => setSkuSortMode('sku')}
                        title="Sort alphabetically by base SKU"
                      >
                        Sort: Base SKU (A-Z)
                      </button>
                    </div>
                    <div className="toolbar-actions">
                      <button className="btn btn-secondary" onClick={exportSkuSummaryCsv}>
                        Download CSV
                      </button>
                      <button className="btn btn-primary" onClick={exportSkuSummaryJson}>
                        Download JSON
                      </button>
                    </div>
                  </div>
                </section>

                <section className="table-wrap">
                  <table className="manifest-table sku-table">
                    <thead>
                      <tr>
                        <th className="row-num">#</th>
                        <th style={{ minWidth: '180px' }}>Base SKU (Normalized)</th>
                        <th style={{ minWidth: '220px' }}>Original Raw SKUs</th>
                        <th style={{ minWidth: '260px' }}>Size Breakdown</th>
                        <th style={{ minWidth: '100px', textAlign: 'center' }}>Total Orders</th>
                        <th style={{ minWidth: '90px', textAlign: 'center' }}>Total Qty</th>
                        <th style={{ minWidth: '120px', textAlign: 'right' }}>Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSkuSummary.map((item, i) => (
                        <tr key={item.baseSku}>
                          <td className="row-num">{i + 1}</td>
                          <td>
                            <strong className="base-sku-name">{item.baseSku}</strong>
                          </td>
                          <td>
                            <div className="raw-sku-tags">
                              {item.rawSkus.map((raw) => (
                                <span className="raw-sku-tag" key={raw}>{raw}</span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <div className="size-breakdown-tags">
                              {item.sortedSizes.map(([sz, qty]) => (
                                <span className="size-pill" key={sz}>
                                  <span className="sz-name">{sz}</span>
                                  <span className="sz-qty">{qty}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                            <span className="order-count-badge">{item.totalOrders}</span>
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                            {item.totalQty}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                            {item.totalAmount ? `₹${item.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
                          </td>
                        </tr>
                      ))}
                      {filteredSkuSummary.length === 0 && (
                        <tr>
                          <td colSpan={7} className="empty-row">
                            No SKUs match “{skuSearchQuery}”.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              </div>
            ) : (
              /* Disguised History View */
              <div className="history-view">
                {!isUnlocked ? (
                  <div className="lock-card">
                    <div className="lock-icon">⚙️</div>
                    <h2>System Diagnostics Console</h2>
                    <p className="lock-subtitle">
                      Enter security authorization key to access diagnostic tools and batch logs.
                    </p>
                    <form className="lock-form" onSubmit={handleUnlockHistory}>
                      <input
                        type="password"
                        className="lock-input"
                        placeholder="Authorization Key"
                        value={passkeyInput}
                        onChange={(e) => setPasskeyInput(e.target.value)}
                        autoFocus
                      />
                      <button type="submit" className="btn btn-primary">
                        Authenticate
                      </button>
                    </form>
                    {passkeyError && <p className="lock-error">{passkeyError}</p>}
                  </div>
                ) : (
                  <div className="history-unlocked">
                    <div className="history-header">
                      <div>
                        <h2>Batch Audit Log &amp; Session Archive (Last 7 Records)</h2>
                        <p className="history-sub">
                          Cached JSON sessions stored locally. You can restore any session to the workspace or export the raw data dump.
                        </p>
                      </div>
                      <div className="history-header-actions">
                        {recentFiles.length > 0 && (
                          <button className="btn btn-ghost" onClick={handleClearHistory}>
                            🗑️ Flush Cache
                          </button>
                        )}
                        <button className="btn btn-secondary" onClick={handleLockHistory}>
                          🔒 Exit &amp; Lock
                        </button>
                      </div>
                    </div>

                    {recentFiles.length === 0 ? (
                      <div className="empty-history-card">
                        <p>No batch sessions logged yet. Processed PDF records will automatically appear in this audit log.</p>
                      </div>
                    ) : (
                      <div className="history-files-list">
                        {recentFiles.map((file, idx) => (
                          <div className="history-file-card" key={file.id || idx}>
                            <div className="history-file-top">
                              <div className="history-file-info">
                                <span className="history-file-num">SESSION #{idx + 1}</span>
                                <div>
                                  <h3 className="history-file-name">{file.fileName}</h3>
                                  <div className="history-file-meta">
                                    <span>🕒 Logged: {file.dateFormatted || file.timestamp}</span>
                                    <span>📦 {file.recordCount} items</span>
                                    <span className="log-status-badge">PARSED</span>
                                  </div>
                                </div>
                              </div>
                              <div className="history-file-actions">
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => loadRecentFile(file)}
                                  title="Restore this session to Manifest & SKU Summary"
                                >
                                  ⚡ Restore Session
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  onClick={() =>
                                    download(
                                      file.fileName.replace(/\.pdf$/i, '') + '_dump.json',
                                      JSON.stringify(file.records, null, 2)
                                    )
                                  }
                                >
                                  📥 Export JSON Dump
                                </button>
                                <button
                                  className="btn btn-ghost"
                                  onClick={() =>
                                    setExpandedPreviewId((cur) => (cur === file.id ? null : file.id))
                                  }
                                >
                                  {expandedPreviewId === file.id ? 'Hide Payload' : '🔍 Inspect Payload'}
                                </button>
                              </div>
                            </div>

                            {expandedPreviewId === file.id && (
                              <div className="history-json-preview">
                                <pre>{JSON.stringify(file.records, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <p className="footnote">
              Extraction is heuristic and reads straight from the PDF text layer — check a
              few rows against the original labels, edit any cell directly if something looks
              off, then export. Edits are included in the downloaded JSON.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
