import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { downloadGitHubReleaseAsset } from './downloadGitHubReleaseAsset.js';

type Handler = (req: IncomingMessage, res: ServerResponse, requestIndex: number) => void;

const BODY = randomBytes(64 * 1024);
const BODY_SHA256 = createHash('sha256').update(BODY).digest('hex');

describe('downloadGitHubReleaseAsset', () => {
  let server: Server | null = null;
  let workDir: string | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
    if (workDir) await rm(workDir, { recursive: true, force: true });
    workDir = null;
  });

  // A real localhost HTTP server is the network boundary; the downloader itself is not mocked.
  async function serve(handler: Handler): Promise<Readonly<{ url: string; requests: IncomingMessage[] }>> {
    const requests: IncomingMessage[] = [];
    server = createServer((req, res) => {
      requests.push(req);
      handler(req, res, requests.length - 1);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    workDir = await mkdtemp(join(tmpdir(), 'happier-download-'));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/asset.bin`, requests };
  }

  /** Sends only the first `cut` bytes of the body, then drops the connection mid-stream. */
  function sendTruncated(res: ServerResponse, start: number, cut: number): void {
    res.writeHead(start === 0 ? 200 : 206, { 'content-length': BODY.length - start });
    res.write(BODY.subarray(start, cut));
    setTimeout(() => res.destroy(), 20);
  }

  function serveRange(req: IncomingMessage, res: ServerResponse): void {
    const match = /^bytes=(\d+)-$/.exec(String(req.headers.range ?? ''));
    const start = match ? Number(match[1]) : 0;
    res.writeHead(match ? 206 : 200, { 'content-length': BODY.length - start });
    res.end(BODY.subarray(start));
  }

  it('resumes a dropped download with an HTTP Range request instead of restarting from byte 0', async () => {
    const { url, requests } = await serve((req, res, index) => (index === 0 ? sendTruncated(res, 0, 20_000) : serveRange(req, res)));
    const destinationPath = join(workDir!, 'asset.bin');

    await downloadGitHubReleaseAsset({ url, destinationPath, digest: `sha256:${BODY_SHA256}` });

    expect(await readFile(destinationPath)).toEqual(BODY);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.range).toMatch(/^bytes=[1-9]\d*-$/);
  });

  it('keeps retrying while every attempt makes progress, rather than giving up after a fixed count', async () => {
    const step = 8 * 1024;
    const { url } = await serve((req, res, index) => {
      const match = /^bytes=(\d+)-$/.exec(String(req.headers.range ?? ''));
      const start = match ? Number(match[1]) : 0;
      if (start + step < BODY.length) sendTruncated(res, start, start + step);
      else serveRange(req, res);
      expect(index).toBeLessThan(20);
    });
    const destinationPath = join(workDir!, 'asset.bin');

    await downloadGitHubReleaseAsset({ url, destinationPath, digest: BODY_SHA256 });

    expect(await readFile(destinationPath)).toEqual(BODY);
  });

  it('restarts cleanly when the server ignores Range and answers 200', async () => {
    const { url } = await serve((_req, res, index) => {
      if (index === 0) return sendTruncated(res, 0, 20_000);
      res.writeHead(200, { 'content-length': BODY.length });
      res.end(BODY);
    });
    const destinationPath = join(workDir!, 'asset.bin');

    await downloadGitHubReleaseAsset({ url, destinationPath, digest: BODY_SHA256 });

    expect(await readFile(destinationPath)).toEqual(BODY);
  });

  it('gives up when attempts stop making progress, and leaves no partial file behind', async () => {
    const { url, requests } = await serve((_req, res) => res.destroy());
    const destinationPath = join(workDir!, 'asset.bin');

    await expect(downloadGitHubReleaseAsset({ url, destinationPath })).rejects.toThrow();

    expect(requests.length).toBeGreaterThan(1);
    expect(await readdir(workDir!)).toEqual([]);
  });

  it('rejects a resumed download whose assembled bytes fail the checksum', async () => {
    const { url } = await serve((req, res, index) => (index === 0 ? sendTruncated(res, 0, 20_000) : serveRange(req, res)));
    const destinationPath = join(workDir!, 'asset.bin');

    await expect(downloadGitHubReleaseAsset({ url, destinationPath, digest: 'sha256:' + '0'.repeat(64) }))
      .rejects.toThrow('checksum verification failed');

    expect(await readdir(workDir!)).toEqual([]);
  });
});
