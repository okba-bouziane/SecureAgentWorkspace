export interface RedactionResult {
  text: string;
  redactions: Record<string, number>;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

interface Rule {
  kind: string;
  regex: RegExp;
  accept?: (match: string) => boolean;
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

const RULES: Rule[] = [
  { kind: "jwt", regex: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g },
  { kind: "api_key", regex: /\b(?:sk|gsk|pk|ghp|xox[bp])[-_][A-Za-z0-9_-]{16,}\b/g },
  { kind: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "iban", regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, accept: (m) => digitsOf(m).length >= 10 },
  {
    kind: "credit_card",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    accept: (m) => {
      const d = digitsOf(m);
      return d.length >= 13 && d.length <= 19 && luhn(d);
    },
  },
  { kind: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    kind: "phone",
    regex: /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){2,4}(?![\w])/g,
    accept: (m) => {
      const d = digitsOf(m).length;
      return d >= 9 && d <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(m);
    },
  },
];

/** Masks personal data in text that is about to leave the system (assistant answers). */
export function redactPii(input: string): RedactionResult {
  let text = input;
  const redactions: Record<string, number> = {};
  for (const rule of RULES) {
    text = text.replace(rule.regex, (match) => {
      if (rule.accept && !rule.accept(match)) return match;
      redactions[rule.kind] = (redactions[rule.kind] ?? 0) + 1;
      return `[redacted ${rule.kind}]`;
    });
  }
  return { text, redactions };
}
