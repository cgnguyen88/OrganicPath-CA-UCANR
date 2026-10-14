import { saveAs } from 'file-saver';
import { toCsv } from '../domain/records/csv.js';

/**
 * Hands a table to the browser to save as a CSV file (opens in Excel, Numbers and Google Sheets).
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} rows a header row, then the data rows
 * @param {string} fileName
 */
export function downloadCsv(rows, fileName) {
  saveAs(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), fileName);
}
