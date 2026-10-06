import { CreateBucketCommand, HeadBucketCommand, S3ServiceException } from '@aws-sdk/client-s3';
import { storageConnection } from './storage.ts';

const endpoint = process.env['S3_ENDPOINT'];
if (
  endpoint === undefined ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)
) {
  throw new Error(
    'storage:setup initializes local MinIO only. Create a private bucket in your storage provider for production.',
  );
}
const { client, bucket } = storageConnection();
try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
} catch (error: unknown) {
  if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404) throw error;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}
console.info(`Private document storage is ready: ${bucket}.`);
client.destroy();
