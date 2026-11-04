"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon.tsx";
import { Button, Field } from "@/components/ui/field.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import {
  calculateChange,
  calculateDiscount,
  evaluateExpression,
  pushHistory,
  type CalcMode,
  type ChangeOutcome,
  type DiscountOutcome,
  type HistoryEntry,
  type HistoryInput,
} from "@/lib/calculator.ts";

const modeTabs: { value: CalcMode; label: string }[] = [
  { value: "standard", label: "Calculator" },
  { value: "discount", label: "Discount" },
  { value: "change", label: "Change" },
];

type KeyAction = "append" | "clear" | "backspace" | "calculate";

interface CalcKey {
  label: string;
  action: KeyAction;
  value?: string;
  tone: "digit" | "operator" | "utility" | "equal";
  span?: boolean;
}

const calcKeys: CalcKey[] = [
  { label: "C", action: "clear", tone: "utility" },
  { label: "⌫", action: "backspace", tone: "utility" },
  { label: "(", action: "append", value: "(", tone: "utility" },
  { label: ")", action: "append", value: ")", tone: "utility" },
  { label: "7", action: "append", value: "7", tone: "digit" },
  { label: "8", action: "append", value: "8", tone: "digit" },
  { label: "9", action: "append", value: "9", tone: "digit" },
  { label: "÷", action: "append", value: "÷", tone: "operator" },
  { label: "4", action: "append", value: "4", tone: "digit" },
  { label: "5", action: "append", value: "5", tone: "digit" },
  { label: "6", action: "append", value: "6", tone: "digit" },
  { label: "×", action: "append", value: "×", tone: "operator" },
  { label: "1", action: "append", value: "1", tone: "digit" },
  { label: "2", action: "append", value: "2", tone: "digit" },
  { label: "3", action: "append", value: "3", tone: "digit" },
  { label: "−", action: "append", value: "-", tone: "operator" },
  { label: "0", action: "append", value: "0", tone: "digit" },
  { label: ".", action: "append", value: ".", tone: "digit" },
  { label: "%", action: "append", value: "%", tone: "operator" },
  { label: "+", action: "append", value: "+", tone: "operator" },
  { label: "=", action: "calculate", tone: "equal", span: true },
];

const keyBase =
  "flex h-10 items-center justify-center rounded-lg border text-sm font-medium transition active:scale-95";

const keyTones = {
  digit: "border-border bg-surface text-foreground hover:bg-surface-muted",
  operator: "border-border bg-surface-muted text-primary hover:bg-surface",
  utility: "border-border bg-surface-muted text-muted hover:bg-surface",
  equal: "border-transparent bg-primary text-surface hover:bg-primary/90",
} as const;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ShopCalculator() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CalcMode>("standard");

  const [expression, setExpression] = useState("");
  const [standardResult, setStandardResult] = useState<string | null>(null);
  const [standardError, setStandardError] = useState<string | null>(null);

  const [price, setPrice] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [discountResult, setDiscountResult] = useState<Extract<DiscountOutcome, { ok: true }> | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);

  const [bill, setBill] = useState("");
  const [received, setReceived] = useState("");
  const [changeResult, setChangeResult] = useState<Extract<ChangeOutcome, { ok: true }> | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);

  const [history, setHistory] = useState<Record<CalcMode, HistoryEntry[]>>({
    standard: [],
    discount: [],
    change: [],
  });
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");

  const primaryInputRef = useRef<HTMLInputElement | null>(null);
  const discountCommittedRef = useRef<string | null>(null);
  const changeCommittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) primaryInputRef.current?.focus();
  }, [mode, open]);

  function resetCopy() {
    setCopyState("idle");
  }

  function addHistoryEntry(input: HistoryInput, label: string, result: string) {
    setHistory((previous) => {
      const entry: HistoryEntry = {
        id: makeId(),
        createdAt: Date.now(),
        input,
        label,
        result,
      };
      return {
        ...previous,
        [input.mode]: pushHistory(previous[input.mode], entry),
      };
    });
  }

  function handleStandardKey() {
    resetCopy();
    const outcome = evaluateExpression(expression);
    if (outcome.ok) {
      setStandardResult(outcome.value);
      setStandardError(null);
      addHistoryEntry({ mode: "standard", expression }, expression, outcome.value);
    } else {
      setStandardResult(null);
      setStandardError(outcome.error);
    }
  }

  function handleStandardKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleStandardKey();
    }
  }

  function handleCalcKey(key: CalcKey) {
    resetCopy();
    if (key.action === "append") {
      setExpression((previous) => previous + (key.value ?? ""));
      setStandardResult(null);
      setStandardError(null);
    } else if (key.action === "clear") {
      setExpression("");
      setStandardResult(null);
      setStandardError(null);
    } else if (key.action === "backspace") {
      setExpression((previous) => previous.slice(0, -1));
      setStandardResult(null);
      setStandardError(null);
    } else {
      handleStandardKey();
    }
  }

  function recalcDiscount(priceValue: string, percentValue: string) {
    resetCopy();
    if (!priceValue.trim() || !percentValue.trim()) {
      setDiscountResult(null);
      setDiscountError(null);
      return;
    }
    const outcome = calculateDiscount(priceValue, percentValue);
    if (outcome.ok) {
      setDiscountResult(outcome);
      setDiscountError(null);
    } else {
      setDiscountResult(null);
      setDiscountError(outcome.error);
    }
  }

  function recalcChange(billValue: string, receivedValue: string) {
    resetCopy();
    if (!billValue.trim() || !receivedValue.trim()) {
      setChangeResult(null);
      setChangeError(null);
      return;
    }
    const outcome = calculateChange(billValue, receivedValue);
    if (outcome.ok) {
      setChangeResult(outcome);
      setChangeError(null);
    } else {
      setChangeResult(null);
      setChangeError(outcome.error);
    }
  }

  function commitDiscount() {
    if (!price.trim() || !discountPercent.trim()) return;
    const outcome = calculateDiscount(price, discountPercent);
    if (!outcome.ok) return;
    const key = `${price}|${discountPercent}`;
    if (discountCommittedRef.current !== key) {
      discountCommittedRef.current = key;
      addHistoryEntry(
        { mode: "discount", price, discountPercent },
        `${price} − ${discountPercent}%`,
        outcome.final,
      );
    }
  }

  function commitChange() {
    if (!bill.trim() || !received.trim()) return;
    const outcome = calculateChange(bill, received);
    if (!outcome.ok) return;
    const key = `${bill}|${received}`;
    if (changeCommittedRef.current !== key) {
      changeCommittedRef.current = key;
      const result =
        outcome.due === "0.00" ? `Change ${outcome.change}` : `Due ${outcome.due}`;
      addHistoryEntry(
        { mode: "change", bill, received },
        `Bill ${bill} · Received ${received}`,
        result,
      );
    }
  }

  function commitCurrent() {
    if (mode === "discount") commitDiscount();
    if (mode === "change") commitChange();
  }

  function clearDiscount() {
    setPrice("");
    setDiscountPercent("");
    setDiscountResult(null);
    setDiscountError(null);
    resetCopy();
  }

  function clearChange() {
    setBill("");
    setReceived("");
    setChangeResult(null);
    setChangeError(null);
    resetCopy();
  }

  function copyText(): string | null {
    if (mode === "standard" && standardResult) return standardResult;
    if (mode === "discount" && discountResult) {
      return `Discount ${discountResult.discount} · Final ${discountResult.final}`;
    }
    if (mode === "change" && changeResult) {
      return `Change ${changeResult.change} · Due ${changeResult.due}`;
    }
    return null;
  }

  async function handleCopy() {
    commitCurrent();
    const text = copyText();
    if (!text || !navigator.clipboard) {
      setCopyState("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  }

  function reuseHistory(entry: HistoryEntry) {
    resetCopy();
    if (entry.input.mode === "standard") {
      setMode("standard");
      setExpression(entry.input.expression);
      setStandardResult(entry.result);
      setStandardError(null);
    } else if (entry.input.mode === "discount") {
      setMode("discount");
      setPrice(entry.input.price);
      setDiscountPercent(entry.input.discountPercent);
      setDiscountError(null);
      recalcDiscount(entry.input.price, entry.input.discountPercent);
    } else {
      setMode("change");
      setBill(entry.input.bill);
      setReceived(entry.input.received);
      setChangeError(null);
      recalcChange(entry.input.bill, entry.input.received);
    }
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    primaryInputRef.current?.focus();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) commitCurrent();
    setOpen(nextOpen);
  }

  function resultRow(label: string, value: string) {
    return (
      <div className="flex items-center justify-between gap-small">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-sm font-semibold text-foreground">{value}</span>
      </div>
    );
  }

  const visibleHistory = history[mode];

  return (
    <>
      <button
        type="button"
        aria-label="Shop calculator"
        title="Shop calculator"
        onClick={() => setOpen(true)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-muted text-primary transition hover:bg-primary/10 active:scale-95 motion-reduce:transition-none"
      >
        <AppIcon name="calculator" className="h-5 w-5" />
      </button>

      <Sheet
        open={open}
        onOpenChange={handleOpenChange}
        title="Shop calculator"
        description="Quick math without leaving the page."
        onOpenAutoFocus={handleOpenAutoFocus}
        hideScrollbar
      >
        <div className="flex flex-col gap-small">
          <div role="tablist" aria-label="Calculator modes" className="flex gap-small">
            {modeTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={mode === tab.value}
                onClick={() => {
                  commitCurrent();
                  setMode(tab.value);
                  resetCopy();
                }}
                className={`flex h-9 flex-1 items-center justify-center rounded-lg border text-xs font-semibold transition ${
                  mode === tab.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted hover:bg-surface-muted"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === "standard" && (
            <div className="flex flex-col gap-small">
              <input
                ref={primaryInputRef}
                value={expression}
                onChange={(event) => {
                  const value = event.target.value;
                  if (/^[0-9+\-*/×÷().%\s]*$/.test(value)) {
                    setExpression(value);
                    setStandardResult(null);
                    setStandardError(null);
                    resetCopy();
                  }
                }}
                onKeyDown={handleStandardKeyDown}
                aria-label="Calculation"
                autoComplete="off"
                spellCheck={false}
                placeholder="0.1 + 0.2"
                className="w-full min-w-0 rounded-lg border border-border bg-surface-muted px-item py-compact text-right text-lg font-semibold tracking-tight text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              <div
                aria-live="polite"
                className="flex min-h-9 items-center justify-between gap-small rounded-lg border border-border bg-surface-muted px-item py-compact"
              >
                <span className="text-xs text-muted">Result</span>
                <span className="text-sm font-semibold text-foreground">
                  {standardResult ?? "—"}
                </span>
              </div>
              {standardError && (
                <p role="alert" className="text-xs font-medium text-danger">
                  {standardError}
                </p>
              )}
              <div className="grid grid-cols-4 gap-compact">
                {calcKeys.map((key) => (
                  <button
                    key={key.label}
                    type="button"
                    onClick={() => handleCalcKey(key)}
                    className={`${keyBase} ${keyTones[key.tone]} ${key.span ? "col-span-4" : ""}`}
                  >
                    {key.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "discount" && (
            <div className="flex flex-col gap-small">
              <Field label="Price" hint="Original price">
                {(props) => (
                  <input
                    ref={primaryInputRef}
                    {...props}
                    value={price}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPrice(value);
                      recalcDiscount(value, discountPercent);
                    }}
                    onBlur={() => commitDiscount()}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="1500"
                  />
                )}
              </Field>
              <Field label="Discount %" hint="Between 0 and 100">
                {(props) => (
                  <input
                    {...props}
                    value={discountPercent}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDiscountPercent(value);
                      recalcDiscount(price, value);
                    }}
                    onBlur={() => commitDiscount()}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="10"
                  />
                )}
              </Field>
              <div className="flex justify-end">
                <Button type="button" variant="ghost" onClick={clearDiscount}>
                  Clear
                </Button>
              </div>
              {discountError && (
                <p role="alert" className="text-xs font-medium text-danger">
                  {discountError}
                </p>
              )}
              {discountResult && (
                <div className="flex flex-col gap-small rounded-lg border border-border bg-surface-muted p-compact">
                  {resultRow("Discount", discountResult.discount)}
                  {resultRow("Final price", discountResult.final)}
                </div>
              )}
            </div>
          )}

          {mode === "change" && (
            <div className="flex flex-col gap-small">
              <Field label="Bill" hint="Amount to collect">
                {(props) => (
                  <input
                    ref={primaryInputRef}
                    {...props}
                    value={bill}
                    onChange={(event) => {
                      const value = event.target.value;
                      setBill(value);
                      recalcChange(value, received);
                    }}
                    onBlur={() => commitChange()}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="850"
                  />
                )}
              </Field>
              <Field label="Received" hint="Amount given by customer">
                {(props) => (
                  <input
                    {...props}
                    value={received}
                    onChange={(event) => {
                      const value = event.target.value;
                      setReceived(value);
                      recalcChange(bill, value);
                    }}
                    onBlur={() => commitChange()}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="1000"
                  />
                )}
              </Field>
              <div className="flex justify-end">
                <Button type="button" variant="ghost" onClick={clearChange}>
                  Clear
                </Button>
              </div>
              {changeError && (
                <p role="alert" className="text-xs font-medium text-danger">
                  {changeError}
                </p>
              )}
              {changeResult && (
                <div className="flex flex-col gap-small rounded-lg border border-border bg-surface-muted p-compact">
                  {resultRow("Change", changeResult.change)}
                  {resultRow("Due", changeResult.due)}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-small">
            <Button type="button" variant="ghost" disabled={!copyText()} onClick={handleCopy}>
              Copy result
            </Button>
            {copyState === "success" && (
              <span role="status" className="text-xs font-medium text-success">
                Copied
              </span>
            )}
            {copyState === "error" && (
              <span role="alert" className="text-xs font-medium text-danger">
                Copy failed
              </span>
            )}
          </div>

          <section className="flex flex-col gap-small">
            <div className="flex items-center justify-between gap-small">
              <h3 className="text-xs font-semibold text-foreground">History</h3>
              {visibleHistory.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setHistory((previous) => ({ ...previous, [mode]: [] }));
                    discountCommittedRef.current = null;
                    changeCommittedRef.current = null;
                    resetCopy();
                  }}
                >
                  Clear history
                </Button>
              )}
            </div>
            {visibleHistory.length === 0 ? (
              <p className="text-xs text-muted">No calculations yet.</p>
            ) : (
              <ol className="flex flex-col gap-small">
                {visibleHistory.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => reuseHistory(entry)}
                      className="flex min-h-9 w-full items-center justify-between gap-small rounded-lg border border-border bg-surface px-item py-compact text-left transition hover:bg-surface-muted"
                    >
                      <span className="min-w-0 truncate text-xs text-muted">
                        {entry.label}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-foreground">
                        {entry.result}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </Sheet>
    </>
  );
}
