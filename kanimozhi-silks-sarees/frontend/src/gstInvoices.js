export const INVOICE_SELLER = {
  name: 'KANIMOZHI SILKS',
  tagline: 'High Class Handloom Silk Cloth Manufacturers',
  gstin: '33BXWPA2606N1Z9',
  address: '#83, Vadakkumada Street, NEDUNGUNAM - 606 807, Cheptet Taluk, T.V. Malai Dist., T.N.',
  phones: ['9965180542', '7904439496'],
  bankDetails: {
    accountNumber: '917020036344070',
    bankName: 'AXIS BANK, ARNII',
    ifsc: 'UTIB0000483',
  },
  hsn: '50079010',
  stateCode: '33',
};

const DATE_PATTERN = /(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\D|$)/;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 20;

const formatDate = (day, month, rawYear) => {
  const year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
  const date = new Date(year, Number(month) - 1, Number(day));
  if (date.getFullYear() !== year || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const dateFromLine = line => {
  if (Number.isFinite(line.confidence) && line.confidence < 45) return '';
  const match = line.text.match(DATE_PATTERN);
  if (!match) return '';
  return formatDate(match[1], match[2], match[3]);
};

const getOcrLines = data => (data.blocks || []).flatMap(block =>
  block.paragraphs.flatMap(paragraph =>
    paragraph.lines.map(line => ({
      text: line.text,
      bbox: line.bbox,
      words: line.words,
      confidence: line.confidence,
    })),
  ),
).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

export function parsePriceListOcrResults(pageResults) {
  const groupsByDate = new Map();
  pageResults.forEach(page => {
    const lines = getOcrLines(page);
    const datedLines = lines
      .map(line => ({ line, date: dateFromLine(line) }))
      .filter(entry => entry.date);

    datedLines.forEach((entry, index) => {
      const nextDateY = datedLines[index + 1]?.line.bbox.y0 ?? Number.POSITIVE_INFINITY;
      const prices = lines
        .flatMap(line => line.words.map(word => ({ word, line })))
        .filter(({ word, line }) =>
          line.bbox.y0 >= entry.line.bbox.y0 &&
          line.bbox.y0 < nextDateY,
        )
        .map(({ word }) => {
          if (Number.isFinite(word.confidence) && word.confidence < 65) return null;
          if (DATE_PATTERN.test(word.text)) return null;
          const match = word.text.match(/\d[\d,]*(?:\.\d{1,2})?/);
          if (!match) return null;
          const normalized = match[0].replace(/,/g, '');
          const wholeNumber = normalized.split('.')[0];
          return wholeNumber.length >= 3 && wholeNumber.length <= 8 && Number(normalized) > 0
            ? normalized
            : null;
        })
        .filter(price => price !== null);
      const group = groupsByDate.get(entry.date) || { id: entry.date, date: entry.date, prices: [] };
      group.prices.push(...prices);
      groupsByDate.set(entry.date, group);
    });
  });
  return [...groupsByDate.values()];
}

const ocrSuggestionScore = data => parsePriceListOcrResults([data])
  .reduce((score, group) => score + 1 + group.prices.length * 2, 0);

const makeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const renderImageFile = async file => {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(2, Math.max(1, 2000 / Math.max(image.width, image.height)));
    const canvas = makeCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.close();
  }
};

const scanPdfFile = async (file, onPage) => {
  const [pdfjsLib, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`The PDF has more than ${MAX_PDF_PAGES} pages. Split it into smaller price lists.`);
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      await onPage(canvas, pageNumber, document.numPages);
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
};

export async function readPriceList(file, onProgress = () => {}) {
  const fileName = file?.name?.toLowerCase() || '';
  const isPdf = file?.type === 'application/pdf' || fileName.endsWith('.pdf');
  const isImage = file?.type?.startsWith('image/') || /\.(?:jpe?g|png|webp)$/i.test(fileName);
  if (!file || (!isImage && !isPdf)) {
    throw new Error('Choose a price-list image or PDF.');
  }
  if (file.size > MAX_FILE_SIZE) throw new Error('The image or PDF must be 15 MB or smaller.');

  const [{ default: Tesseract }, { default: workerPath }, { default: corePath }] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url'),
    import('tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'),
  ]);

  let pageNumber = 1;
  let pageCount = 1;
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath,
    corePath,
    logger: message => {
      if (message.status === 'recognizing text') {
        const progress = (pageNumber - 1 + message.progress) / pageCount;
        onProgress(Math.round(progress * 100));
      }
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '3',
      user_defined_dpi: '300',
    });
    const pageResults = [];
    const recognizePage = async (canvas, currentPage, totalPages) => {
      pageNumber = currentPage;
      pageCount = totalPages;
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      let bestResult = data;
      if (ocrSuggestionScore(data) < 5) {
        await worker.setParameters({ tessedit_pageseg_mode: '11' });
        const retry = await worker.recognize(canvas, {}, { blocks: true });
        if (ocrSuggestionScore(retry.data) > ocrSuggestionScore(bestResult)) {
          bestResult = retry.data;
        }
        await worker.setParameters({ tessedit_pageseg_mode: '3' });
      }
      pageResults.push(bestResult);
    };
    if (isPdf) {
      await scanPdfFile(file, recognizePage);
    } else {
      await recognizePage(await renderImageFile(file), 1, 1);
    }
    onProgress(100);
    return parsePriceListOcrResults(pageResults);
  } finally {
    await worker.terminate();
  }
}

const numberToWords = value => {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const twoDigits = number => {
    if (number < 10) return ones[number];
    if (number < 20) return teens[number - 10];
    return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ''}`;
  };
  const underThousand = number => {
    const hundreds = Math.floor(number / 100);
    const remainder = number % 100;
    return [
      hundreds ? `${ones[hundreds]} hundred` : '',
      remainder ? twoDigits(remainder) : '',
    ].filter(Boolean).join(' and ');
  };

  if (!Number.isSafeInteger(value) || value < 0) return '';
  if (value === 0) return 'zero';
  const groups = [
    [Math.floor(value / 10000000), 'crore'],
    [Math.floor((value % 10000000) / 100000), 'lakh'],
    [Math.floor((value % 100000) / 1000), 'thousand'],
    [value % 1000, ''],
  ];
  return groups
    .filter(([amount]) => amount > 0)
    .map(([amount, label]) => `${underThousand(amount)}${label ? ` ${label}` : ''}`)
    .join(' ');
};

const fromPaise = value => value / 100;

export function createGstInvoice(
  dateGroup,
  customer,
  invoiceNumber,
  sellerGstin = INVOICE_SELLER.gstin,
  bankDetails = INVOICE_SELLER.bankDetails,
  authorisedSignature = '',
) {
  const prices = dateGroup.prices.map(Number);
  const items = prices.map((price, index) => ({
    number: index + 1,
    description: 'HCS Sarees',
    hsn: INVOICE_SELLER.hsn,
    quantity: 1,
    ratePaise: Math.round(price * 100),
  }));
  const subtotalPaise = items.reduce((total, item) => total + item.ratePaise, 0);
  const isSameState = customer.gstin.slice(0, 2) === sellerGstin.slice(0, 2);
  const cgstPaise = isSameState ? Math.round(subtotalPaise * 250 / 10000) : 0;
  const sgstPaise = isSameState ? Math.round(subtotalPaise * 250 / 10000) : 0;
  const igstPaise = isSameState ? 0 : Math.round(subtotalPaise * 500 / 10000);
  const totalPaise = subtotalPaise + cgstPaise + sgstPaise + igstPaise;
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  const amountWords = `Indian Rupees ${numberToWords(rupees)}${paise ? ` and ${numberToWords(paise)} paise` : ''} only`;

  return {
    id: `${dateGroup.date}-${invoiceNumber}`,
    invoiceNumber,
    date: dateGroup.date,
    customer: { ...customer },
    sellerGstin,
    bankDetails: { ...bankDetails },
    authorisedSignature,
    items,
    sameState: isSameState,
    subtotal: fromPaise(subtotalPaise),
    cgst: fromPaise(cgstPaise),
    sgst: fromPaise(sgstPaise),
    igst: fromPaise(igstPaise),
    total: fromPaise(totalPaise),
    amountWords,
  };
}
