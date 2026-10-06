import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { z } from 'zod';

// Evidence bundle manifest (docs/BRIEF.md "Evidence bundle"). Hash = SHA-256 of RFC 8785 canonical JSON.
export const EvidenceStep = z.object({
  url: z.string(),
  action: z.string(),
  timestamp: z.string(),
  screenshot_sha256: z.string().nullable(),
});
export const EvidenceManifest = z.object({
  task_id: z.string(),
  merchant: z.string(),
  vigil_type: z.string(),
  steps: z.array(EvidenceStep),
  page_text_excerpts: z.array(z.string()),
  outcome: z.string(),
  confirmation_code: z.string().nullable(),
});
export type EvidenceManifest = z.infer<typeof EvidenceManifest>;

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** RFC 8785 canonical JSON. Throws if the value cannot be canonicalised. */
export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (typeof out !== 'string') throw new Error('value is not canonicalisable');
  return out;
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Parse JSON text and reject duplicate object keys before hashing (JSON.parse would silently keep the last).
 */
export function parseStrictJson(text: string): unknown {
  const seen: Set<string>[] = [];
  let depthKeys: Set<string> | null = null;
  // Light tokenizer: track keys per object nesting level.
  let i = 0;
  const stack: ('{' | '[')[] = [];
  let expectKey = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          s += text[j]! + text[j + 1]!;
          j += 2;
          continue;
        }
        s += text[j];
        j++;
      }
      if (stack[stack.length - 1] === '{' && expectKey) {
        depthKeys = seen[seen.length - 1]!;
        if (depthKeys.has(s)) throw new Error(`duplicate key "${s}"`);
        depthKeys.add(s);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (ch === '{') {
      stack.push('{');
      seen.push(new Set());
      expectKey = true;
    } else if (ch === '[') stack.push('[');
    else if (ch === '}') {
      stack.pop();
      seen.pop();
    } else if (ch === ']') stack.pop();
    else if (ch === ',' && stack[stack.length - 1] === '{') expectKey = true;
    i++;
  }
  return JSON.parse(text);
}

export function hashEvidence(manifest: EvidenceManifest): string {
  return hashCanonical(EvidenceManifest.parse(manifest));
}
