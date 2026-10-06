// Redaction applied to any text before it may reach a model (docs/BRIEF.md <find>: "redact card numbers,
// addresses and phone numbers before any model call"). Pure, regex-based, conservative: it prefers
// over-redacting to leaking.

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 13-19 digits, optionally grouped by spaces or dashes.
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
// "ending 4417", "**** 4417", "xxxx-4417": keep the fact a card was used, drop the digits.
const CARD_TAIL = /(?:\b(ending(?: in)?|last ?4:?)|[*xX•]{4})[ -]?\s*\d{4}\b/gi;
// International or local phone numbers: +65 6123 4567, (555) 123-4567, 555-123-4567, 9123 4567.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{3,4})?\b/g;
const STREET_SUFFIX =
  'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Terrace|Crescent|Cres|Close|Parkway|Pkwy|Square|Sq|Highway|Hwy|Walk|Circle|Cir|Trail|Row|Hill|Grove|Mews|Loop|Rise|Point|Vista|Ridge|Park|Gardens|Heights|View';
// "1234 Elm Street", "88 Orchard Rd #12-03", "Blk 123 Ang Mo Kio Ave 3", "Apt. 4B", "Suite 200".
const STREET = new RegExp(
  `\\b(?:(?:Blk|Block)\\s+)?\\d{1,6}[A-Za-z]?\\s+(?:[A-Z][A-Za-z'.-]*\\s+){0,4}(?:${STREET_SUFFIX})\\b\\.?(?:\\s*(?:#\\d{1,3}-\\d{1,4}|\\d{1,4}))?(?:,?\\s*(?:Apt\\.?|Apartment|Suite|Ste\\.?|Unit)\\s*[A-Za-z0-9-]+)?`,
  'g',
);
const UNIT = /\b(?:Apt\.?|Apartment|Suite|Ste\.?|Unit)\s+[A-Za-z0-9-]+\b/g;
const POSTCODE_SG = /\bSingapore\s+\d{6}\b/gi;

export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(CARD, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[card]' : m;
    })
    .replace(CARD, (m) => (m.replace(/\D/g, '').length >= 15 ? '[card]' : m)) // long digit runs even if Luhn fails
    .replace(CARD_TAIL, (_m, lead: string | undefined) => `${lead ?? 'card'} [last4]`)
    .replace(STREET, '[address]')
    .replace(UNIT, '[address]')
    .replace(POSTCODE_SG, '[address]')
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[phone]' : m));
}
