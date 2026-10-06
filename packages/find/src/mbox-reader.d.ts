declare module 'mbox-reader' {
  import type { Readable } from 'node:stream';
  export interface MboxMessage {
    returnPath: string;
    time: Date | false;
    content: Buffer;
    flags: string[];
    labels: string[];
    headers: Map<string, string[]>;
  }
  export function mboxReader(input: Readable, options?: { gz?: boolean }): AsyncGenerator<MboxMessage>;
}
