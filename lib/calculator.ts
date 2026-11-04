import { fromCents, MONEY_PATTERN, toCents } from "./numeric.ts";

export type CalculatorErrorCode =
  | "invalid-expression"
  | "division-by-zero"
  | "invalid-input"
  | "number-too-large"
  | "incomplete-input";

export type CalculatorFailure = {
  ok: false;
  error: string;
  code: CalculatorErrorCode;
};

export type CalculatorResult = { ok: true; value: string };

export type CalculatorOutcome = CalculatorResult | CalculatorFailure;

export type DiscountOutcome =
  | { ok: true; discount: string; final: string }
  | CalculatorFailure;

export type ChangeOutcome =
  | { ok: true; change: string; due: string }
  | CalculatorFailure;

export type CalcMode = "standard" | "discount" | "change";

export type HistoryInput =
  | { mode: "standard"; expression: string }
  | { mode: "discount"; price: string; discountPercent: string }
  | { mode: "change"; bill: string; received: string };

export interface HistoryEntry {
  id: string;
  createdAt: number;
  input: HistoryInput;
  label: string;
  result: string;
}

export const HISTORY_LIMIT = 20;

class CalcError extends Error {
  code: CalculatorErrorCode;
  constructor(code: CalculatorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type Rational = { n: bigint; d: bigint };

const SCALE = 12;
const POW10: readonly bigint[] = Array.from({ length: SCALE + 1 }, (_, i) =>
  BigInt(`1${"0".repeat(i)}`),
);
const SCALE_FACTOR = POW10[SCALE];
const MAX_COEFFICIENT = BigInt("999999999999999999999999");
const HUNDRED = BigInt(100);

function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a < BigInt(0) ? -a : a;
}

function reduce(r: Rational): Rational {
  if (r.n === BigInt(0)) return { n: BigInt(0), d: BigInt(1) };
  let n = r.n;
  let d = r.d;
  if (d < BigInt(0)) {
    n = -n;
    d = -d;
  }
  const g = gcd(n < BigInt(0) ? -n : n, d);
  return { n: n / g, d: d / g };
}

function add(a: Rational, b: Rational): Rational {
  return reduce({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
}

function subtract(a: Rational, b: Rational): Rational {
  return reduce({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
}

function multiply(a: Rational, b: Rational): Rational {
  return reduce({ n: a.n * b.n, d: a.d * b.d });
}

function divide(a: Rational, b: Rational): Rational {
  if (b.n === BigInt(0)) throw new CalcError("division-by-zero", "Cannot divide by zero.");
  return reduce({ n: a.n * b.d, d: a.d * b.n });
}

function negate(a: Rational): Rational {
  return { n: -a.n, d: a.d };
}

function percentFraction(a: Rational): Rational {
  return reduce({ n: a.n, d: a.d * HUNDRED });
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, "");
}

function parseRational(text: string): Rational {
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > SCALE) {
    throw new CalcError("number-too-large", "Too many decimal places.");
  }
  return reduce({
    n: BigInt(stripLeadingZeros(whole + fraction)),
    d: POW10[fraction.length],
  });
}

function parseSignedRational(text: string): Rational {
  const trimmed = text.trim();
  if (!trimmed) throw new CalcError("invalid-input", "Enter a number.");
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d+)?$/.test(body)) {
    throw new CalcError("invalid-input", "Enter a valid number.");
  }
  const value = parseRational(body);
  return negative ? negate(value) : value;
}

function formatRational(value: Rational): string {
  if (value.n === BigInt(0)) return "0";
  const sign = value.n < BigInt(0) ? "-" : "";
  const numerator = value.n < BigInt(0) ? -value.n : value.n;
  const scaled = divideRound(numerator * SCALE_FACTOR, value.d);
  if (scaled > MAX_COEFFICIENT) {
    throw new CalcError("number-too-large", "Result is too large.");
  }
  const whole = scaled / SCALE_FACTOR;
  const fraction = scaled % SCALE_FACTOR;
  if (fraction === BigInt(0)) return `${sign}${whole}`;
  const fractionText = fraction
    .toString()
    .padStart(SCALE, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}.${fractionText}`;
}

function divideRound(a: bigint, b: bigint): bigint {
  if (b === BigInt(0)) throw new CalcError("division-by-zero", "Cannot divide by zero.");
  const negative = (a < BigInt(0)) !== (b < BigInt(0));
  const numerator = a < BigInt(0) ? -a : a;
  const denominator = b < BigInt(0) ? -b : b;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const result = quotient + (remainder * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
  return negative ? -result : result;
}

function asFailure(error: unknown): CalculatorFailure {
  if (error instanceof CalcError) {
    return { ok: false, error: error.message, code: error.code };
  }
  return { ok: false, error: "Invalid calculation.", code: "invalid-expression" };
}

export function evaluateExpression(input: string): CalculatorOutcome {
  const source = input.trim();
  if (!source) {
    return { ok: false, error: "Enter a calculation.", code: "incomplete-input" };
  }
  if (source.length > 120) {
    return { ok: false, error: "Calculation is too long.", code: "invalid-expression" };
  }

  let index = 0;
  const length = source.length;

  function skipWhitespace() {
    while (index < length && /\s/.test(source[index])) index += 1;
  }

  function peek(): string | undefined {
    return source[index];
  }

  function parseNumber(): Rational {
    skipWhitespace();
    const start = index;
    while (index < length && /\d/.test(source[index])) index += 1;
    if (index < length && source[index] === ".") {
      index += 1;
      while (index < length && /\d/.test(source[index])) index += 1;
    }
    const text = source.slice(start, index);
    if (!/\d/.test(text)) throw new CalcError("invalid-expression", "Expected a number.");
    return parseRational(text);
  }

  function applyPercent(value: Rational): Rational {
    let current = value;
    skipWhitespace();
    while (index < length && source[index] === "%") {
      index += 1;
      current = percentFraction(current);
      skipWhitespace();
    }
    return current;
  }

  function parsePrimary(): Rational {
    skipWhitespace();
    if (index >= length) throw new CalcError("incomplete-input", "Incomplete calculation.");
    if (peek() === "(") {
      index += 1;
      const value = parseExpression();
      skipWhitespace();
      if (peek() !== ")") throw new CalcError("invalid-expression", "Missing closing parenthesis.");
      index += 1;
      return applyPercent(value);
    }
    return applyPercent(parseNumber());
  }

  function parseUnary(): Rational {
    skipWhitespace();
    if (peek() === "-") {
      index += 1;
      return negate(parseUnary());
    }
    if (peek() === "+") {
      index += 1;
      return parseUnary();
    }
    return parsePrimary();
  }

  function parseTerm(): Rational {
    let value = parseUnary();
    skipWhitespace();
    while (index < length && ["*", "/", "×", "÷"].includes(source[index])) {
      const operator = source[index];
      index += 1;
      const right = parseUnary();
      value = operator === "*" || operator === "×"
        ? multiply(value, right)
        : divide(value, right);
      skipWhitespace();
    }
    return value;
  }

  function parseExpression(): Rational {
    let value = parseTerm();
    skipWhitespace();
    while (index < length && ["+", "-"].includes(source[index])) {
      const operator = source[index];
      index += 1;
      const right = parseTerm();
      value = operator === "+" ? add(value, right) : subtract(value, right);
      skipWhitespace();
    }
    return value;
  }

  try {
    const value = parseExpression();
    skipWhitespace();
    if (index < length) throw new CalcError("invalid-expression", "Invalid calculation.");
    return { ok: true, value: formatRational(value) };
  } catch (error) {
    return asFailure(error);
  }
}

export function percentOf(value: string, percent: string): CalculatorOutcome {
  try {
    const amount = parseSignedRational(value);
    const rate = parseSignedRational(percent);
    return { ok: true, value: formatRational(percentFraction(multiply(amount, rate))) };
  } catch (error) {
    return asFailure(error);
  }
}

function parsePercentScaled(text: string): bigint {
  const [whole, fraction = ""] = text.split(".");
  const digits = stripLeadingZeros(whole + fraction.padEnd(2, "0"));
  return BigInt(digits);
}

export function calculateDiscount(price: string, discountPercent: string): DiscountOutcome {
  const priceText = price.trim();
  const percentText = discountPercent.trim();

  if (!MONEY_PATTERN.test(priceText)) {
    return { ok: false, error: "Enter a valid price (up to 2 decimals).", code: "invalid-input" };
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(percentText)) {
    return { ok: false, error: "Enter a discount between 0 and 100.", code: "invalid-input" };
  }

  const percentScaled = parsePercentScaled(percentText);
  if (percentScaled > BigInt(10000)) {
    return { ok: false, error: "Discount must be between 0 and 100.", code: "invalid-input" };
  }

  const priceCents = toCents(priceText);
  const discountCents = divideRound(priceCents * percentScaled, BigInt(10000));
  const finalCents = priceCents - discountCents;

  return { ok: true, discount: fromCents(discountCents), final: fromCents(finalCents) };
}

export function calculateChange(bill: string, received: string): ChangeOutcome {
  const billText = bill.trim();
  const receivedText = received.trim();

  if (!MONEY_PATTERN.test(billText)) {
    return { ok: false, error: "Enter a valid bill amount.", code: "invalid-input" };
  }
  if (!MONEY_PATTERN.test(receivedText)) {
    return { ok: false, error: "Enter a valid received amount.", code: "invalid-input" };
  }

  const billCents = toCents(billText);
  const receivedCents = toCents(receivedText);

  if (receivedCents >= billCents) {
    return {
      ok: true,
      change: fromCents(receivedCents - billCents),
      due: fromCents(BigInt(0)),
    };
  }

  return {
    ok: true,
    change: fromCents(BigInt(0)),
    due: fromCents(billCents - receivedCents),
  };
}

export function pushHistory(history: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, HISTORY_LIMIT);
}

export function clearHistory(): HistoryEntry[] {
  return [];
}
