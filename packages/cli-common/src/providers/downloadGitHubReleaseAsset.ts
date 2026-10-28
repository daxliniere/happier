import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_REDIRECTS = 5;
const DOWNLOAD_RETRY_DELAYS_MS = [250, 1_000] as const;

function normalizeExpectedSha256(digest: string | null | undefined): string | null {
  const raw = typeof digest === 'string' ? digest.trim() : '';
  if (!raw) return null;
  const normalized = raw.startsWith('sha256:') ? raw.slice('sha256:'.length) : raw;
  return normalized.trim().toLowerCase() || null;
}

function isRedirect(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function openGitHubReleaseAssetResponse(
  url: string,
  headers: Readonly<Record<string, string>>,
  redirectCount = 0,
): Promise<IncomingMessage> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error('[github-release] too many redirects while downloading asset');
  }

  const target = new URL(url);
  const requestImpl = target.protocol === 'https:' ? httpsRequest : httpRequest;

  return await new Promise<IncomingMessage>((resolve, reject) => {
    const req = requestImpl(target, { headers }, (response) => {
      const statusCode = Number(response.statusCode ?? 0);
      const location = typeof response.headers.location === 'string' ? response.headers.location.trim() : '';
      if (isRedirect(statusCode) && location) {
        response.resume();
        const nextUrl = new URL(location, target).toString();
        void openGitHubReleaseAssetResponse(nextUrl, headers, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`[github-release] failed to download asset (${statusCode || 'unknown'})`));
        return;
      }
      resolve(response);
    });
    req.on('error', reject);
    req.end();
  });
}

export async function downloadGitHubReleaseAsset(params: Readonly<{
  url: string;
  destinationPath: string;
  digest?: string | null;
  userAgent?: string;
}>): Promise<void> {
  const url = String(params.url ?? '').trim();
  const destinationPath = String(params.destinationPath ?? '').trim();
  const userAgent = String(params.userAgent ?? '').trim() || 'happier-cli';
  if (!url) throw new Error('[github-release] url is required');
  if (!destinationPath) throw new Error('[github-release] destinationPath is required');

  const headers = {
    'user-agent': userAgent,
    accept: 'application/octet-stream',
  };
  const expectedSha256 = normalizeExpectedSha256(params.digest);

  await mkdir(dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.download`;
  // Start clean: a leftover partial from an unrelated earlier download is not known to match this asset.
  await rm(tempPath, { force: true });

  // The retry delays are consumed only by attempts that make no progress. A download that keeps
  // advancing (resumed with HTTP Range) is not abandoned just because the link keeps dropping.
  let stalledAttempts = 0;

  for (;;) {
    const resumeFrom = await readPartialSize(tempPath);
    try {
      const response = await openGitHubReleaseAssetResponse(
        url,
        resumeFrom > 0 ? { ...headers, range: `bytes=${resumeFrom}-` } : headers,
      );
      const resumed = resumeFrom > 0 && Number(response.statusCode) === 206;
      const hash = createHash('sha256');
      if (resumed) {
        // The checksum covers the whole asset, so the bytes already on disk are hashed first.
        await pipeline(createReadStream(tempPath), hashTap(hash), discard());
      }
      await pipeline(response, hashTap(hash), createWriteStream(tempPath, { flags: resumed ? 'a' : 'w' }));
      if (expectedSha256) {
        const actualSha256 = hash.digest('hex');
        if (actualSha256 !== expectedSha256) {
          throw new Error('[github-release] checksum verification failed');
        }
      }
      await rename(tempPath, destinationPath);
      return;
    } catch (error) {
      if (isRangeNotSatisfiable(error)) {
        // The partial file is not a prefix this server can continue; discard it and start over.
        await rm(tempPath, { force: true }).catch(() => undefined);
        continue;
      }
      const progressed = (await readPartialSize(tempPath)) > resumeFrom;
      if (progressed) {
        stalledAttempts = 0;
      } else {
        stalledAttempts += 1;
      }
      const retryDelayMs = DOWNLOAD_RETRY_DELAYS_MS[Math.max(0, stalledAttempts - 1)] ?? null;
      if (!isRetryableDownloadError(error) || (!progressed && retryDelayMs === null)) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        if (error instanceof Error) throw error;
        throw new Error(String(error));
      }
      if (!progressed) await new Promise((resolve) => setTimeout(resolve, retryDelayMs ?? 0));
    }
  }
}

async function readPartialSize(path: string): Promise<number> {
  return (await stat(path).catch(() => null))?.size ?? 0;
}

function hashTap(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

function discard(): Transform {
  return new Transform({ transform: (_chunk, _encoding, callback) => callback() });
}

function isRangeNotSatisfiable(error: unknown): boolean {
  return error instanceof Error && error.message === '[github-release] failed to download asset (416)';
}

function isRetryableDownloadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/^\[github-release\] failed to download asset \((502|503|504)\)$/.test(message)) {
    return true;
  }
  if (error && typeof error === 'object') {
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EPIPE') {
      return true;
    }
  }
  return false;
}
