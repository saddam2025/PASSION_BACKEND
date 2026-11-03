import { createHash, randomBytes } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppEnvironment } from '../config/env';

export type StorageBucket = 'public' | 'private';
export interface StoragePutOptions { bucket: StorageBucket; key: string; body: Buffer; contentType: string; cacheControl?: string }
export interface StorageObject { body: Buffer; contentType: string }
export interface StorageDriver {
  put(options: StoragePutOptions): Promise<void>;
  get(bucket: StorageBucket, key: string): Promise<StorageObject | null>;
  delete(bucket: StorageBucket, key: string): Promise<void>;
  exists(bucket: StorageBucket, key: string): Promise<boolean>;
  signedGetUrl(bucket: StorageBucket, key: string, expiresSeconds: number): Promise<string>;
}

export class MemoryStorageDriver implements StorageDriver {
  readonly objects = new Map<string, StorageObject>();
  private ref(bucket: StorageBucket, key: string) { return `${bucket}:${key}`; }
  async put({ bucket, key, body, contentType }: StoragePutOptions) { this.objects.set(this.ref(bucket, key), { body: Buffer.from(body), contentType }); }
  async get(bucket: StorageBucket, key: string) { const value = this.objects.get(this.ref(bucket, key)); return value ? { body: Buffer.from(value.body), contentType: value.contentType } : null; }
  async delete(bucket: StorageBucket, key: string) { this.objects.delete(this.ref(bucket, key)); }
  async exists(bucket: StorageBucket, key: string) { return this.objects.has(this.ref(bucket, key)); }
  async signedGetUrl(bucket: StorageBucket, key: string, expiresSeconds: number) {
    if (bucket !== 'private' || !await this.exists(bucket, key)) throw new Error('Private object unavailable');
    const expiry = Math.floor(Date.now() / 1000) + expiresSeconds;
    const signature = createHash('sha256').update(`${bucket}:${key}:${expiry}:${randomBytes(24).toString('hex')}`).digest('hex');
    return `memory://private/${encodeURIComponent(key)}?expires=${expiry}&signature=${signature}`;
  }
}

export class R2StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  constructor(private readonly environment: AppEnvironment) {
    if (!environment.R2_ACCOUNT_ID || !environment.R2_ACCESS_KEY_ID || !environment.R2_SECRET_ACCESS_KEY) throw new Error('R2 configuration is incomplete');
    this.client = new S3Client({ region: 'auto', endpoint: `https://${environment.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: environment.R2_ACCESS_KEY_ID, secretAccessKey: environment.R2_SECRET_ACCESS_KEY } });
  }
  private bucket(bucket: StorageBucket) { return bucket === 'public' ? this.environment.R2_PUBLIC_BUCKET! : this.environment.R2_PRIVATE_BUCKET!; }
  async put({ bucket, key, body, contentType, cacheControl }: StoragePutOptions) { await this.client.send(new PutObjectCommand({ Bucket: this.bucket(bucket), Key: key, Body: body, ContentType: contentType, ...(cacheControl ? { CacheControl: cacheControl } : {}) })); }
  async get(bucket: StorageBucket, key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
    if (!result.Body) return null;
    return { body: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType ?? 'application/octet-stream' };
  }
  async delete(bucket: StorageBucket, key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(bucket), Key: key })); }
  async exists(bucket: StorageBucket, key: string) {
    try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket(bucket), Key: key })); return true; }
    catch (error) { if (error && typeof error === 'object' && '$metadata' in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; }
  }
  signedGetUrl(bucket: StorageBucket, key: string, expiresSeconds: number) { return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }), { expiresIn: expiresSeconds }); }
}

let memoryDriver: MemoryStorageDriver | undefined;
export function createStorageDriver(environment: AppEnvironment): StorageDriver {
  if (environment.NODE_ENV === 'test') {
    memoryDriver ??= new MemoryStorageDriver();
    return memoryDriver;
  }
  const hasR2 = Boolean(environment.R2_ACCOUNT_ID && environment.R2_ACCESS_KEY_ID && environment.R2_SECRET_ACCESS_KEY && environment.R2_PUBLIC_BUCKET && environment.R2_PRIVATE_BUCKET && environment.R2_PUBLIC_BASE_URL);
  if (hasR2) return new R2StorageDriver(environment);
  if (environment.NODE_ENV === 'production') throw new Error('Production storage requires the complete R2 configuration.');
  memoryDriver ??= new MemoryStorageDriver();
  return memoryDriver;
}
