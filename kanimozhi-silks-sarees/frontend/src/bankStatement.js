const DATE_PATTERN = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/;
const AMOUNT_PATTERN = /(?:₹\s*|INR\s*)-?\(?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?\)?|(?:₹\s*|INR\s*)-?\(?\d+(?:\.\d{1,2})?\)?|(?<![\d/])-?\d+\.\d{2}/gi;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_PAGES = 100;
const COLUMN_TOLERANCE = 30;

const validDate = (year, month, day) => {
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseDate = value => {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return validDate(iso[1], iso[2], iso[3]);

  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numeric) {
    const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
    return validDate(year, numeric[2], numeric[1]);
  }

  const named = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (!named) return '';
  const month = new Date(`${named[2]} 1, 2000`).getMonth() + 1;
  const year = named[3].length === 2 ? `20${named[3]}` : named[3];
  return month ? validDate(year, month, named[1]) : '';
};

const amountValue = value => Number(value.replace(/[₹,\s]|INR/gi, '').replace(/[()]/g, ''));

const getLines = textContent => {
  const lines = [];
  for (const item of textContent.items) {
    if (!item.str?.trim()) continue;
    const y = item.transform[5];
    let line = lines.find(candidate => Math.abs(candidate.y - y) < 2.5);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ text: item.str.trim(), x: item.transform[4] });
  }
  return lines
    .map(line => ({ ...line, items: line.items.sort((a, b) => a.x - b.x), text: line.items.map(item => item.text).join(' ') }))
    .sort((a, b) => b.y - a.y);
};

const findColumns = pages => {
  for (const lines of pages) {
    const header = lines.slice(0, 80).find(line => {
      const labels = line.items.map(item => item.text.toLowerCase());
      return labels.some(label => /\bdebit\b/.test(label)) &&
        labels.some(label => /\bcredit\b/.test(label)) &&
        labels.some(label => /\bbalance\b/.test(label));
    });
    if (!header) continue;

    const column = pattern => header.items.find(item => pattern.test(item.text.toLowerCase()))?.x;
    const columns = {
      debit: column(/\bdebit\b/),
      credit: column(/\bcredit\b/),
      balance: column(/\bbalance\b/),
    };
    const positions = Object.values(columns);
    if (positions.every(value => value !== undefined) &&
      new Set(positions).size === 3 &&
      positions.every((position, index) =>
        positions.slice(index + 1).every(other => Math.abs(position - other) > COLUMN_TOLERANCE * 2),
      )) return columns;
  }
  throw new Error('This PDF does not show reliably separated Debit, Credit, and Balance columns. No transactions were imported.');
};

const amountTokensFor = line => line.items.flatMap(item => {
  const text = item.text.replace(DATE_PATTERN, ' ');
  return [...text.matchAll(AMOUNT_PATTERN)].map(match => ({
    text: match[0].trim(),
    value: amountValue(match[0]),
    x: item.x + match.index,
  })).filter(token => Number.isFinite(token.value));
});

const nearestToken = (tokens, x, used) => {
  const available = tokens.filter(token => !used.has(token));
  if (x === undefined || !available.length) return null;
  const nearest = available.reduce((best, token) => Math.abs(token.x - x) < Math.abs(best.x - x) ? token : best);
  return Math.abs(nearest.x - x) <= COLUMN_TOLERANCE ? nearest : null;
};

const cleanDescription = line => line.text
  .replace(DATE_PATTERN, ' ')
  .replace(AMOUNT_PATTERN, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^[\s|:-]+|[\s|:-]+$/g, '')
  .trim();

const isDescriptionContinuation = (line, columns) => {
  if (DATE_PATTERN.test(line.text) || amountTokensFor(line).length) return false;
  const firstItemX = line.items[0]?.x;
  const firstAmountColumn = Math.min(columns.debit, columns.credit, columns.balance);
  return firstItemX !== undefined &&
    firstItemX > COLUMN_TOLERANCE * 2 &&
    firstItemX < firstAmountColumn - COLUMN_TOLERANCE;
};

const getTransaction = (line, columns, pageNumber) => {
  const dateMatch = line.text.match(DATE_PATTERN);
  if (!dateMatch) return null;
  const date = parseDate(dateMatch[0]);
  if (!date) return null;

  const tokens = amountTokensFor(line);
  if (!tokens.length) return null;

  const used = new Set();
  const debit = nearestToken(tokens, columns.debit, used);
  if (debit) used.add(debit);
  const credit = nearestToken(tokens, columns.credit, used);
  if (credit) used.add(credit);
  const balance = nearestToken(tokens, columns.balance, used);

  if (!debit && !credit) {
    throw new Error(`A dated amount on page ${pageNumber} could not be matched to the Debit or Credit column. The PDF was not imported.`);
  }
  if (debit && credit) {
    throw new Error(`A dated row on page ${pageNumber} matched both Debit and Credit columns. The PDF was not imported.`);
  }
  if (!balance) {
    throw new Error(`A transaction on page ${pageNumber} could not be matched to the Balance column. The PDF was not imported.`);
  }

  return {
    date,
    description: cleanDescription(line) || 'Transaction',
    debit: debit ? Math.abs(debit.value) : null,
    credit: credit ? Math.abs(credit.value) : null,
    balance: Math.abs(balance.value),
  };
};

export async function parseBankStatementDocument(document) {
  if (document.numPages > MAX_PAGES) {
    throw new Error(`The PDF has more than ${MAX_PAGES} pages. Split it into smaller statements and try again.`);
  }

  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    pages.push(getLines(await page.getTextContent()));
  }

  const columns = findColumns(pages);
  const transactions = pages.flatMap((lines, pageIndex) => {
    const pageTransactions = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const transaction = getTransaction(lines[lineIndex], columns, pageIndex + 1);
      if (!transaction) continue;

      const continuationDescriptions = [];
      let nextLineY = lines[lineIndex].y;
      for (let previousIndex = lineIndex - 1; previousIndex >= 0; previousIndex -= 1) {
        const previousLine = lines[previousIndex];
        const verticalGap = previousLine.y - nextLineY;
        if (verticalGap <= 0 || verticalGap > 12 || !isDescriptionContinuation(previousLine, columns)) break;
        continuationDescriptions.unshift(cleanDescription(previousLine));
        nextLineY = previousLine.y;
      }

      const rowDescription = transaction.description === 'Transaction' ? '' : transaction.description;
      transaction.description = [...continuationDescriptions, rowDescription].filter(Boolean).join(' ') || 'Transaction';
      pageTransactions.push(transaction);
    }
    return pageTransactions;
  });
  if (!transactions.length) {
    throw new Error('No transactions could be extracted. Use a text-based PDF with dated rows and separate Debit, Credit, and Balance columns.');
  }
  return transactions;
}

export async function extractBankStatement(file) {
  if (!file || (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) {
    throw new Error('Choose a PDF transaction statement.');
  }
  if (file.size > MAX_FILE_SIZE) throw new Error('The PDF must be 15 MB or smaller.');

  const [pdfjsLib, { default: pdfWorkerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  try {
    return await parseBankStatementDocument(await loadingTask.promise);
  } finally {
    await loadingTask.destroy();
  }
}
