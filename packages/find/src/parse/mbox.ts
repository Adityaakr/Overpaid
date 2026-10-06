/// <reference path="../mbox-reader.d.ts" />
import { Readable } from 'node:stream';
import { mboxReader } from 'mbox-reader';
import type { EmailRecord } from '../types.js';
import { parseEmail, type ParseEmailOptions } from './email.js';

/** Parse every message in an mbox export (optionally gzipped, e.g. a Gmail Takeout). */
export async function parseMbox(bytes: Uint8Array, sourceId: string, opts: ParseEmailOptions & { gz?: boolean } = {}): Promise<EmailRecord[]> {
  const out: EmailRecord[] = [];
  for await (const message of mboxReader(Readable.from([Buffer.from(bytes)]), { gz: opts.gz ?? false })) {
    out.push(await parseEmail(message.content, sourceId, opts));
  }
  return out;
}
