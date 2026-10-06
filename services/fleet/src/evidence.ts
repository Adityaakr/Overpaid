import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { canonicalJson, hashEvidence, sha256Hex, type EvidenceManifest } from '@overpaid/shared';

export interface EvidenceStepRec {
  url: string;
  action: string;
  timestamp: string;
  screenshot_sha256: string | null;
  file: string | null;
}

/** Evidence bundle under evidence/<taskId>/: one PNG per step (sha256 each) and an RFC 8785 manifest.json. */
export class EvidenceRecorder {
  readonly dir: string;
  readonly steps: EvidenceStepRec[] = [];
  readonly excerpts: string[] = [];
  private n = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    root: string,
    readonly taskId: string,
  ) {
    if (!/^[A-Za-z0-9._-]+$/.test(taskId)) throw new Error('taskId must match [A-Za-z0-9._-]+');
    this.dir = path.join(root, taskId);
  }

  async init(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
    await fs.mkdir(this.dir, { recursive: true });
  }

  /** Save a screenshot as a step. Serialised so step order is stable. Never throws. */
  record(page: Page | null, action: string): Promise<EvidenceStepRec> {
    const p = this.chain.then(() => this.doRecord(page, action));
    this.chain = p.catch(() => {});
    return p;
  }

  private async doRecord(page: Page | null, action: string): Promise<EvidenceStepRec> {
    const idx = ++this.n;
    const rec: EvidenceStepRec = { url: page?.url() ?? '', action, timestamp: new Date().toISOString(), screenshot_sha256: null, file: null };
    if (page && !page.isClosed()) {
      try {
        const png = await page.screenshot({ type: 'png', timeout: 5000 });
        const file = `step-${String(idx).padStart(3, '0')}.png`;
        await fs.writeFile(path.join(this.dir, file), png);
        rec.screenshot_sha256 = sha256Hex(png);
        rec.file = file;
      } catch {
        /* page navigating or closed: keep the step without a screenshot */
      }
    }
    this.steps.push(rec);
    return rec;
  }

  async saveImage(name: string, data: Buffer): Promise<string> {
    await fs.writeFile(path.join(this.dir, name), data);
    return sha256Hex(data);
  }

  excerpt(text: string): void {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (t && !this.excerpts.includes(t)) this.excerpts.push(t);
  }

  /** Write manifest.json as canonical JSON, so sha256(file bytes) === hashEvidence(manifest). */
  async finalize(m: { merchant: string; vigil_type: string; outcome: string; confirmation_code: string | null }): Promise<{ sha256: string; path: string; manifest: EvidenceManifest }> {
    await this.chain;
    const manifest: EvidenceManifest = {
      task_id: this.taskId,
      merchant: m.merchant,
      vigil_type: m.vigil_type,
      steps: this.steps.map(({ url, action, timestamp, screenshot_sha256 }) => ({ url, action, timestamp, screenshot_sha256 })),
      page_text_excerpts: this.excerpts,
      outcome: m.outcome,
      confirmation_code: m.confirmation_code,
    };
    const sha256 = hashEvidence(manifest);
    const file = path.join(this.dir, 'manifest.json');
    await fs.writeFile(file, canonicalJson(manifest));
    return { sha256, path: file, manifest };
  }
}
