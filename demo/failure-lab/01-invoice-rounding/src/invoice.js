// Invoice totals. Amounts are in dollars as floats (this is the bug surface).

/** Tax for one line, rounded to the cent. */
export function lineTax(amount, rate) {
  return Math.round(amount * rate * 100) / 100;
}

/** Total of all lines plus per-line tax. */
export function invoiceTotal(lines, rate) {
  let total = 0;
  for (const l of lines) total += l.qty * l.price + lineTax(l.qty * l.price, rate);
  return Math.round(total * 100) / 100;
}

/** Format for display, e.g. 1234.5 -> "$1,234.50". */
export function formatMoney(amount) {
  return "$" + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
