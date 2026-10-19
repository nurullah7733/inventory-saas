export const ARTICLE_NUMBER_PATTERN = /^[1-9]\d{0,9}$/;
export const ARTICLE_NUMBER_START = 2000;
export const MAX_ARTICLE_NUMBER = 2147483647;

export function isArticleNumber(code: string): boolean {
  return ARTICLE_NUMBER_PATTERN.test(code) && Number(code) <= MAX_ARTICLE_NUMBER;
}

/** Skip existing SKU/barcode aliases; never issue an ambiguous scan code. */
export function nextArticleNumbers(last: number, count: number, blocked: ReadonlySet<string>): number[] {
  last = Math.max(last, ARTICLE_NUMBER_START - 1);
  const numbers: number[] = [];
  while (numbers.length < count) {
    last++;
    if (!Number.isSafeInteger(last) || last > MAX_ARTICLE_NUMBER) throw new Error("Article number range exhausted.");
    if (!blocked.has(String(last))) numbers.push(last);
  }
  return numbers;
}
