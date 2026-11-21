// Builds a CSV file that opens correctly in Excel.
function escapeCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Stops a cell that starts with = + - @ from being run as a formula in Excel.
  if (/^[=+\-@]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ header: 'Teacher', value: (row) => row.teacher_name }, ...]
function toCsv(columns, rows) {
  const lines = [columns.map((column) => escapeCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // The first character (BOM) tells Excel the file is UTF-8, so ñ and ₱ show correctly.
  res.send('\uFEFF' + toCsv(columns, rows));
}

module.exports = { toCsv, sendCsv };
