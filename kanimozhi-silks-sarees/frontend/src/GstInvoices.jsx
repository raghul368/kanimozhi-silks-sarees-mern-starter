import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Plus, Printer, Trash2, X } from 'lucide-react';
import {
  createGstInvoice,
  INVOICE_SELLER,
  readPriceList,
} from './gstInvoices.js';
import sellerLogo from './assets/kanimozhi-silks-logo.png';
import defaultAuthorisedSignature from './assets/kanimozhi-authorised-signature.png';

const emptyDateGroup = () => ({
  id: `${Date.now()}-${Math.random()}`,
  date: '',
  prices: [''],
});

const formatMoney = value => Number(value).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatInvoiceDate = value => {
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year.slice(-2)}`;
};

const GSTIN_PATTERN = /^\d{2}[A-Z0-9]{13}$/;
const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli', '27': 'Maharashtra',
  '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

const trimSignatureImage = dataUrl => new Promise((resolve, reject) => {
  const image = new Image();
  image.onerror = () => reject(new Error('Unable to process the authorised signature image.'));
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Unable to process the authorised signature image.'));
      return;
    }
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const pixel = (y * canvas.width + x) * 4;
        if (data[pixel + 3] > 0 && Math.min(data[pixel], data[pixel + 1], data[pixel + 2]) < 190) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left || bottom < top) {
      resolve(dataUrl);
      return;
    }
    const padding = Math.max(4, Math.round(Math.max(canvas.width, canvas.height) * 0.02));
    left = Math.max(0, left - padding);
    top = Math.max(0, top - padding);
    right = Math.min(canvas.width, right + padding + 1);
    bottom = Math.min(canvas.height, bottom + padding + 1);
    const trimmed = document.createElement('canvas');
    trimmed.width = right - left;
    trimmed.height = bottom - top;
    const trimmedContext = trimmed.getContext('2d');
    if (!trimmedContext) {
      reject(new Error('Unable to process the authorised signature image.'));
      return;
    }
    trimmedContext.drawImage(image, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
    resolve(trimmed.toDataURL('image/png'));
  };
  image.src = dataUrl;
});

function InvoicePaper({ invoice, selected, paperRef }) {
  const rows = Array.from({ length: Math.max(14, invoice.items.length) }, (_, index) => invoice.items[index]);
  const stateCode = invoice.customer.gstin.slice(0, 2);

  return <article ref={paperRef} className={`gst-invoice-paper${selected ? ' gst-invoice-print-selected' : ''}`}>
    <header className="gst-invoice-header">
      <small>GSTIN: {invoice.sellerGstin}</small>
      <img className="gst-invoice-logo" src={sellerLogo} alt="Kanimozhi Silks logo"/>
      <div className="gst-invoice-phones">Cell: {INVOICE_SELLER.phones.map(phone => <span key={phone}>{phone}</span>)}</div>
      <h2>{INVOICE_SELLER.name}</h2>
      <b>{INVOICE_SELLER.tagline}</b>
      <p>{INVOICE_SELLER.address}</p>
    </header>

    <div className="gst-invoice-title-row">
      <span>Invoice No.: <b>{invoice.invoiceNumber}</b></span>
      <strong>TAX INVOICE</strong>
      <span>Invoice Date: <b>{formatInvoiceDate(invoice.date)}</b></span>
    </div>

    <section className="gst-invoice-customer">
      <div><b>Name</b><span>{invoice.customer.name}</span></div>
      <div><b>Address</b><span>{invoice.customer.address}</span></div>
      <div><b>GSTIN</b><span>{invoice.customer.gstin}</span></div>
      <div><b>State</b><span>{GST_STATES[stateCode] || ''}</span></div>
      <div><b>State Code</b><span>{stateCode}</span></div>
    </section>

    <table className="gst-invoice-items">
      <thead><tr><th>S. No.</th><th>Name of Product</th><th>HSN / SAC<br/>{INVOICE_SELLER.hsn}</th><th>Qty.</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>
        {rows.map((item, index) => <tr key={index}>
          <td>{item?.number || ''}</td><td>{item?.description || ''}</td><td>{item?.hsn || ''}</td>
          <td>{item?.quantity || ''}</td><td>{item ? formatMoney(item.ratePaise / 100) : ''}</td>
          <td>{item ? formatMoney(item.ratePaise / 100) : ''}</td>
        </tr>)}
      </tbody>
      <tfoot><tr><th colSpan="3">Total</th><th>{invoice.items.length}</th><th></th><th>{formatMoney(invoice.subtotal)}</th></tr></tfoot>
    </table>

    <div className="gst-invoice-bottom">
      <section className="gst-invoice-words">
        <div className="gst-invoice-amount-words-block">
          <b>Total Invoice Amount in Words:</b>
        <p className="gst-invoice-amount-words">{invoice.amountWords}</p>
        </div>
        <div className="gst-invoice-bank-details">
          <b>Bank Details</b>
          <p><span>Bank Account Number</span><strong>{invoice.bankDetails.accountNumber}</strong></p>
          <p><span>Bank Name / Branch</span><strong>{invoice.bankDetails.bankName}</strong></p>
          <p><span>IFSC</span><strong>{invoice.bankDetails.ifsc}</strong></p>
        </div>
      </section>
      <table className="gst-invoice-totals">
        <tbody>
          <tr><td>Discount</td><td></td><td>0.00</td></tr>
          <tr><td>Total Amount Before Tax</td><td></td><td>{formatMoney(invoice.subtotal)}</td></tr>
          <tr><td>Add : CGST</td><td>2.5%</td><td>{formatMoney(invoice.cgst)}</td></tr>
          <tr><td>Add : SGST</td><td>2.5%</td><td>{formatMoney(invoice.sgst)}</td></tr>
          <tr><td>Add : IGST</td><td>5%</td><td>{formatMoney(invoice.igst)}</td></tr>
          <tr><td>Tax Amount : GST</td><td></td><td>{formatMoney(invoice.cgst + invoice.sgst + invoice.igst)}</td></tr>
          <tr className="gst-invoice-grand-total"><th colSpan="2">Total Amount After Tax</th><th>{formatMoney(invoice.total)}</th></tr>
          <tr><td colSpan="2">GST Payable on Reverse Charge</td><td>No</td></tr>
        </tbody>
      </table>
    </div>

    <footer className="gst-invoice-signature">
      <span>For: {INVOICE_SELLER.name}</span>
      <div className="gst-invoice-authorised">
        {invoice.authorisedSignature&&<img src={invoice.authorisedSignature} alt=""/>}
        <span>Authorised Signatory</span>
      </div>
    </footer>
  </article>;
}

export default function GstInvoices() {
  const [sourceFile, setSourceFile] = useState(null);
  const [draftGroups, setDraftGroups] = useState([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [sourceMessage, setSourceMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [customer, setCustomer] = useState({ name: '', address: '', gstin: '' });
  const [sellerGstin, setSellerGstin] = useState(INVOICE_SELLER.gstin);
  const [sellerBank, setSellerBank] = useState(() => ({ ...INVOICE_SELLER.bankDetails }));
  const [authorisedSignature, setAuthorisedSignature] = useState(defaultAuthorisedSignature);
  const [firstInvoiceNumber, setFirstInvoiceNumber] = useState('452');
  const [invoices, setInvoices] = useState([]);
  const [previewId, setPreviewId] = useState('');
  const [jpgBusy, setJpgBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const fileInput = useRef(null);
  const invoicePaper = useRef(null);
  const ocrRequest = useRef(0);

  useEffect(() => {
    if (!sourceFile) {
      setSourceUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  const previewInvoice = invoices.find(invoice => invoice.id === previewId);

  const downloadInvoiceJpg = async () => {
    if (!invoicePaper.current || !previewInvoice) {
      setDownloadError('The invoice preview is not ready to download.');
      return;
    }
    setJpgBusy(true);
    setDownloadError('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(invoicePaper.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) throw new Error('The browser could not create the JPG image.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kanimozhi-silks-invoice-${previewInvoice.invoiceNumber}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadFailure) {
      setDownloadError(downloadFailure.message || 'Unable to download this invoice as a JPG.');
    } finally {
      setJpgBusy(false);
    }
  };

  const updateGroup = (groupId, update) => {
    setConfirmed(false);
    setDraftGroups(groups => groups.map(group => group.id === groupId ? update(group) : group));
  };

  const selectSource = event => {
    const file = event.target.files?.[0] || null;
    setSourceFile(file);
    setDraftGroups([]);
    setConfirmed(false);
    setSourceMessage('');
    setError('');
    event.currentTarget.value = '';
    if (file) {
      void extractDraft(file);
    } else {
      ocrRequest.current += 1;
      setOcrBusy(false);
    }
  };

  const extractDraft = async (file = sourceFile) => {
    if (!file) {
      setError('Choose a handwritten price-list image or PDF first.');
      return;
    }
    const requestId = ++ocrRequest.current;
    setOcrBusy(true);
    setOcrProgress(0);
    setError('');
    setSourceMessage('');
    setDraftGroups([]);
    setConfirmed(false);
    try {
      const groups = await readPriceList(file, progress => {
        if (requestId === ocrRequest.current) setOcrProgress(progress);
      });
      if (requestId !== ocrRequest.current) return;
      setDraftGroups(groups.length
        ? groups.map(group => ({ ...group, prices: group.prices.length ? group.prices : [''] }))
        : [emptyDateGroup()]);
      const priceCount = groups.reduce((count, group) => count + group.prices.length, 0);
      setSourceMessage(groups.length
        ? priceCount
          ? `OCR found ${groups.length} date${groups.length === 1 ? '' : 's'} and ${priceCount} higher-confidence price suggestion${priceCount === 1 ? '' : 's'}. Suggestions may be incomplete; check each value and add any missing prices.`
          : `OCR found ${groups.length} date${groups.length === 1 ? '' : 's'} but could not read prices confidently. Add or correct prices manually while viewing the uploaded list.`
        : 'OCR could not confidently read any dates. Add the dates and prices manually while viewing the uploaded list.');
    } catch (ocrError) {
      if (requestId !== ocrRequest.current) return;
      setDraftGroups([emptyDateGroup()]);
      setError(ocrError.message || 'Unable to read this price list. You can still add dates and prices manually.');
    } finally {
      if (requestId === ocrRequest.current) setOcrBusy(false);
    }
  };

  const addDateGroup = () => {
    setConfirmed(false);
    setDraftGroups(groups => [...groups, emptyDateGroup()]);
  };

  const addPrice = groupId => updateGroup(groupId, group => ({ ...group, prices: [...group.prices, ''] }));

  const updatePrice = (groupId, priceIndex, value) => updateGroup(groupId, group => ({
    ...group,
    prices: group.prices.map((price, index) => index === priceIndex ? value : price),
  }));

  const selectAuthorisedSignature = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for the authorised signature.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('The authorised signature image must be 2 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') {
        setError('Unable to read the authorised signature image.');
        return;
      }
      try {
        setAuthorisedSignature(await trimSignatureImage(reader.result));
      } catch (signatureError) {
        setError(signatureError.message || 'Unable to process the authorised signature image.');
      }
    };
    reader.onerror = () => setError('Unable to read the authorised signature image.');
    reader.readAsDataURL(file);
  };

  const removePrice = (groupId, priceIndex) => updateGroup(groupId, group => ({
    ...group,
    prices: group.prices.length === 1
      ? ['']
      : group.prices.filter((_, index) => index !== priceIndex),
  }));

  const removeInvoice = invoiceId => {
    setInvoices(current => current.filter(invoice => invoice.id !== invoiceId));
    setPreviewId(current => current === invoiceId ? '' : current);
  };

  const generateInvoices = event => {
    event.preventDefault();
    setError('');
    if (!confirmed) {
      setError('Compare the dates and every price with the uploaded list, then confirm before creating invoices.');
      return;
    }

    const normalizedCustomer = {
      name: customer.name.trim(),
      address: customer.address.trim(),
      gstin: customer.gstin.trim().toUpperCase(),
    };
    const normalizedSellerGstin = sellerGstin.trim().toUpperCase();
    if (!normalizedCustomer.name || !normalizedCustomer.address) {
      setError('Enter the customer name and address.');
      return;
    }
    if (!GSTIN_PATTERN.test(normalizedCustomer.gstin)) {
      setError('Enter a valid 15-character customer GSTIN.');
      return;
    }
    if (!GSTIN_PATTERN.test(normalizedSellerGstin)) {
      setError('Enter a valid 15-character seller GSTIN.');
      return;
    }
    const startNumber = Number(firstInvoiceNumber);
    if (!Number.isSafeInteger(startNumber) || startNumber < 1) {
      setError('Enter a valid first invoice number.');
      return;
    }
    if (!draftGroups.length || draftGroups.some(group =>
      !/^\d{4}-\d{2}-\d{2}$/.test(group.date) ||
      !group.prices.length ||
      group.prices.some(price => !Number.isFinite(Number(price)) || Number(price) <= 0),
    )) {
      setError('Each date needs at least one valid price. Check all date and price fields.');
      return;
    }
    const dates = draftGroups.map(group => group.date);
    if (new Set(dates).size !== dates.length) {
      setError('Each date must appear only once. Combine the prices for a date into one group.');
      return;
    }
    const existingDates = new Set(invoices.map(invoice => invoice.date));
    if (dates.some(date => existingDates.has(date))) {
      setError('An invoice for one of these dates already exists in this admin session.');
      return;
    }

    const sortedGroups = [...draftGroups].sort((a, b) => a.date.localeCompare(b.date));
    if (!Number.isSafeInteger(startNumber + sortedGroups.length - 1)) {
      setError('The invoice number range is too large.');
      return;
    }
    const existingNumbers = new Set(invoices.map(invoice => invoice.invoiceNumber));
    if (sortedGroups.some((_, index) => existingNumbers.has(startNumber + index))) {
      setError('One of these invoice numbers already exists in this admin session. Choose a new starting number.');
      return;
    }
    const createdInvoices = sortedGroups.map((group, index) =>
      createGstInvoice(group, normalizedCustomer, startNumber + index, normalizedSellerGstin, sellerBank, authorisedSignature),
    );
    setInvoices(current => [...current, ...createdInvoices].sort((a, b) => a.date.localeCompare(b.date)));
    setFirstInvoiceNumber(String(startNumber + createdInvoices.length));
    setDraftGroups([]);
    setSourceFile(null);
    setConfirmed(false);
    if (fileInput.current) fileInput.current.value = '';
    setSourceMessage(`${createdInvoices.length} date-specific invoice${createdInvoices.length === 1 ? '' : 's'} created. Use Preview / Print to save each invoice as a PDF.`);
  };

  return <section className="admin-panel gst-invoice-panel">
    <h2><FileText/> GST invoice generator</h2>
    <p className="bank-history-note">Upload a handwritten date-wise price list and OCR will automatically fill editable date and higher-confidence price suggestions. Unclear values may be left blank; compare every value with the image and add missing prices before creating invoices. The English OCR model may download on first use, but the uploaded file and invoices are not sent to the store server.</p>

    <div className="gst-upload-area">
      <label>Handwritten price list (photo or scanned PDF)
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,application/pdf" onChange={selectSource}/>
      </label>
      <button type="button" className="gold-btn" onClick={()=>extractDraft()} disabled={ocrBusy||!sourceFile}>
        <FileText size={15}/>{ocrBusy?`READING ${ocrProgress}%…`:sourceFile?'READ PRICE LIST AGAIN':'READ PRICE LIST'}
      </button>
      {sourceFile&&<p className="gst-source-name">{sourceFile.name}</p>}
      {sourceMessage&&<p className="admin-message" role="status">{sourceMessage}</p>}
      {error&&<p className="admin-message" role="alert">{error}</p>}
      {sourceUrl&&sourceFile&&<div className="gst-source-preview">
        {sourceFile.type==='application/pdf'||sourceFile.name.toLowerCase().endsWith('.pdf')
          ? <iframe title="Uploaded price-list PDF" src={sourceUrl}/>
          : <img src={sourceUrl} alt="Uploaded handwritten price list"/>}
      </div>}
    </div>

    {draftGroups.length>0&&<form className="gst-review-form" onSubmit={generateInvoices}>
      <section className="gst-customer-fields">
        <h3>Customer details (used for all dates)</h3>
        <label>Customer / GST name<input required maxLength="120" value={customer.name} onChange={event=>setCustomer(current=>({...current,name:event.target.value}))} placeholder="Customer name"/></label>
        <label>Customer address<textarea required maxLength="300" rows="2" value={customer.address} onChange={event=>setCustomer(current=>({...current,address:event.target.value}))} placeholder="Customer address"/></label>
        <label>Customer GSTIN<input required maxLength="15" value={customer.gstin} onChange={event=>setCustomer(current=>({...current,gstin:event.target.value.toUpperCase()}))} placeholder="15-character GSTIN"/></label>
        <label>Seller GSTIN<input required maxLength="15" value={sellerGstin} onChange={event=>setSellerGstin(event.target.value.toUpperCase())}/></label>
        <label>First invoice number<input required type="number" min="1" step="1" value={firstInvoiceNumber} onChange={event=>setFirstInvoiceNumber(event.target.value)}/></label>
        <label>Seller bank account number (optional)<input maxLength="34" value={sellerBank.accountNumber} onChange={event=>setSellerBank(current=>({...current,accountNumber:event.target.value}))}/></label>
        <label>Seller bank name / branch (optional)<input maxLength="120" value={sellerBank.bankName} onChange={event=>setSellerBank(current=>({...current,bankName:event.target.value}))}/></label>
        <label>Seller IFSC (optional)<input maxLength="11" value={sellerBank.ifsc} onChange={event=>setSellerBank(current=>({...current,ifsc:event.target.value.toUpperCase()}))}/></label>
        <label>Authorised signature image (replace default)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectAuthorisedSignature}/></label>
        {authorisedSignature&&<div className="gst-signature-upload-preview">
          <img src={authorisedSignature} alt="Authorised signature preview"/>
          <button type="button" className="outline-btn" onClick={()=>setAuthorisedSignature('')}>REMOVE SIGNATURE</button>
        </div>}
        <p className="bank-history-note">GST uses 2.5% CGST + 2.5% SGST when the customer GSTIN state code matches the seller; otherwise it uses 5% IGST.</p>
        <p className="bank-history-note">The provided default signature is included in the frontend build. Any replacement image is kept in this admin session.</p>
      </section>

      <div className="gst-date-groups-heading">
        <div><h3>Review dates and item prices</h3><p>Each listed price becomes one HCS Sarees invoice item, quantity 1.</p></div>
        <button type="button" className="outline-btn" onClick={addDateGroup}><Plus size={14}/> ADD DATE</button>
      </div>
      <div className="gst-date-groups">
        {draftGroups.map((group, groupIndex) => <article className="gst-date-group" key={group.id}>
          <div className="gst-date-group-header">
            <label>Date {groupIndex+1}<input required type="date" value={group.date} onChange={event=>updateGroup(group.id,current=>({...current,date:event.target.value}))}/></label>
            <button type="button" className="gst-remove-button" aria-label={`Remove date ${groupIndex+1}`} onClick={()=>{setConfirmed(false);setDraftGroups(groups=>groups.filter(item=>item.id!==group.id));}}><Trash2 size={15}/></button>
          </div>
          <div className="gst-price-list">
            {group.prices.map((price, priceIndex) => <label key={`${group.id}-${priceIndex}`}>Item {priceIndex+1} price (₹)
              <span><input required type="number" min="0.01" step="0.01" value={price} onChange={event=>updatePrice(group.id,priceIndex,event.target.value)}/><button type="button" className="gst-remove-button" aria-label={`Remove item ${priceIndex+1}`} onClick={()=>removePrice(group.id,priceIndex)}><X size={14}/></button></span>
            </label>)}
          </div>
          <button type="button" className="gst-add-price" onClick={()=>addPrice(group.id)}><Plus size={13}/> Add item price</button>
          <div className="gst-subtotal-preview">Subtotal: ₹{formatMoney(group.prices.reduce((total,price)=>total+(Number(price)||0),0))}</div>
        </article>)}
      </div>
      <label className="gst-confirm-review"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> I checked every date and price against the uploaded list.</label>
      <button className="gold-btn" type="submit"><FileText size={15}/> CREATE DATE-WISE GST INVOICES</button>
    </form>}

    <section className="gst-generated-section">
      <h3>Generated invoices <span>{invoices.length}</span></h3>
      {invoices.length===0?<p className="admin-sub">Invoices you create will be listed here for this admin session. Print / Save PDF to keep a copy.</p>:<div className="gst-generated-list">
        {invoices.map(invoice=><article key={invoice.id}>
          <div><b>Invoice {invoice.invoiceNumber}</b><span>{formatInvoiceDate(invoice.date)}</span><small>{invoice.customer.name} · ₹{formatMoney(invoice.total)}</small></div>
          <div className="gst-generated-actions">
            <button type="button" className="outline-btn" onClick={()=>setPreviewId(invoice.id)}><Printer size={14}/> PREVIEW / PRINT</button>
            <button type="button" className="outline-btn" onClick={()=>removeInvoice(invoice.id)}><Trash2 size={14}/> REMOVE</button>
          </div>
        </article>)}
      </div>}
    </section>

    {previewInvoice&&<div className="gst-invoice-modal" role="dialog" aria-modal="true" aria-label={`Invoice ${previewInvoice.invoiceNumber}`}>
      <div className="gst-invoice-modal-actions">
        <button type="button" className="gold-btn" onClick={downloadInvoiceJpg} disabled={jpgBusy}><Download size={14}/>{jpgBusy?'CREATING JPG…':'DOWNLOAD JPG'}</button>
        <button type="button" className="gold-btn" onClick={()=>window.print()}><Printer size={14}/> PRINT / SAVE PDF</button>
        <button type="button" className="outline-btn" onClick={()=>setPreviewId('')}><X size={14}/> CLOSE</button>
      </div>
      {downloadError&&<p className="gst-download-error" role="alert">{downloadError}</p>}
      <InvoicePaper invoice={previewInvoice} selected paperRef={invoicePaper}/>
    </div>}
  </section>;
}
