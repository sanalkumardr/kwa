import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object storage for uploaded photos. The upload controller depends only on
 * this interface, so swapping local disk for S3 (or MinIO / any S3-compatible
 * gateway) is a config change, not a code change.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  /** A URL the client can use to fetch the object (presigned for S3). */
  getDownloadUrl(key: string): Promise<string>;
}

export const STORAGE = 'STORAGE';

/** Dev/default: writes under UPLOAD_DIR. Not suitable for multi-replica prod. */
export class LocalDiskStorage implements Storage {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer): Promise<void> {
    const dest = join(this.root, key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
  }

  async getDownloadUrl(key: string): Promise<string> {
    return `file://${join(this.root, key)}`;
  }
}

export interface S3Options {
  region: string;
  endpoint?: string; // for MinIO / non-AWS gateways
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Production: S3-compatible object storage with presigned download URLs. */
export class S3Storage implements Storage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    opts: S3Options,
  ) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? {
              accessKeyId: opts.accessKeyId,
              secretAccessKey: opts.secretAccessKey,
            }
          : undefined, // fall back to instance role / env credentials
    });
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 },
    );
  }
}
