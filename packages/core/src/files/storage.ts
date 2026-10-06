import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { internal, validationFailed } from '@gravity/shared/errors';
import { z } from 'zod';

export interface FileStorage {
  uploadUrl(key: string, mimeType: string, size: number): Promise<string>;
  sealUpload(source: string, target: string, size: number): Promise<void>;
  downloadUrl(key: string, name: string, preview: boolean, mimeType?: string): Promise<string>;
  readText(key: string): Promise<string>;
}

const storageConfigSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1).default('us-east-1'),
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
});

export function storageConnection(): { client: S3Client; bucket: string } {
  const parsed = storageConfigSchema.safeParse({
    bucket: process.env['S3_BUCKET'],
    region: process.env['S3_REGION'],
    endpoint: process.env['S3_ENDPOINT'] || undefined,
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] || undefined,
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] || undefined,
  });
  if (!parsed.success)
    throw internal('Document storage is not configured. Set S3_BUCKET and storage credentials.');
  const config = parsed.data;
  const client = new S3Client({
    region: config.region,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint, forcePathStyle: true }),
    ...(config.accessKeyId === undefined || config.secretAccessKey === undefined
      ? {}
      : {
          credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        }),
  });
  return { client, bucket: config.bucket };
}

export function objectStorage(): FileStorage {
  const { client, bucket: Bucket } = storageConnection();
  return {
    uploadUrl: async (Key, ContentType, ContentLength) =>
      await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key,
          ContentType,
          ContentLength,
        }),
        { expiresIn: 600 },
      ),
    sealUpload: async (source, Key, size) => {
      const head = await client.send(new HeadObjectCommand({ Bucket, Key: source }));
      if (head.ContentLength !== size || head.ETag === undefined)
        throw validationFailed('The uploaded file size does not match. Upload it again.');
      await client.send(
        new CopyObjectCommand({
          Bucket,
          Key,
          CopySource: `${Bucket}/${source.split('/').map(encodeURIComponent).join('/')}`,
          CopySourceIfMatch: head.ETag,
          MetadataDirective: 'REPLACE',
          ContentType: 'application/octet-stream',
        }),
      );
    },
    downloadUrl: async (Key, name, preview, mimeType = 'application/pdf') =>
      await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key,
          ResponseContentType: preview ? mimeType : 'application/octet-stream',
          ResponseContentDisposition: `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
          ResponseCacheControl: 'private, no-store',
        }),
        { expiresIn: 60 },
      ),
    readText: async (Key) => {
      const result = await client.send(new GetObjectCommand({ Bucket, Key }));
      if (result.Body === undefined) throw internal('The uploaded file could not be read.');
      return await result.Body.transformToString('utf-8');
    },
  };
}
