import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PreconditionFailed, type ObjectPutOptions, type ObjectStore } from './api-types';
import { compareStrings } from './hashing';

/** The shape of an SDK service exception that the mapping below reads. */
interface S3ErrorShape {
  readonly name?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: unknown };
}

/** `name` and `$metadata.httpStatusCode` of a rejection; a non-object carries neither. */
const s3ErrorFields = (error: unknown): { readonly name: unknown; readonly status: unknown } => {
  if (typeof error !== 'object' || error === null) return { name: undefined, status: undefined };
  const rec = error as S3ErrorShape;
  return { name: rec.name, status: rec.$metadata?.httpStatusCode };
};

const isNoSuchKey = (error: unknown): boolean => {
  const { name, status } = s3ErrorFields(error);
  return name === 'NoSuchKey' || status === 404;
};

const isS3Precondition = (error: unknown): boolean => {
  const { name, status } = s3ErrorFields(error);
  return (
    name === 'PreconditionFailed' ||
    name === 'ConditionalRequestConflict' ||
    status === 412 ||
    status === 409
  );
};

const listPage = async (
  client: S3Client,
  bucket: string,
  prefix: string,
  continuation: string | undefined,
): Promise<{ readonly keys: readonly string[]; readonly next: string | undefined }> => {
  const out = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuation,
    }),
  );
  const keys: string[] = [];
  for (const obj of out.Contents ?? []) {
    if (obj.Key !== undefined) keys.push(obj.Key);
  }
  const next = out.IsTruncated === true ? out.NextContinuationToken : undefined;
  return { keys, next };
};

export const createS3Store = (bucket: string, client: S3Client = new S3Client({})): ObjectStore => ({
  get: async (key) => {
    try {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = out.Body;
      if (body === undefined) return undefined;
      return await body.transformToString();
    } catch (error: unknown) {
      if (isNoSuchKey(error)) return undefined;
      throw error;
    }
  },
  put: async (key, body, options?: ObjectPutOptions) => {
    const command: {
      Bucket: string;
      Key: string;
      Body: string;
      ContentType: string;
      IfMatch?: string | undefined;
      IfNoneMatch?: string;
    } = { Bucket: bucket, Key: key, Body: body, ContentType: 'application/json' };
    if (options?.ifNoneMatch === '*') {
      command.IfNoneMatch = '*';
    }
    if (options?.ifMatch !== undefined) {
      const current = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch(
        (error: unknown) => {
          if (isNoSuchKey(error)) return undefined;
          throw error;
        },
      );
      if (current === undefined) throw new PreconditionFailed();
      const currentBody = current.Body === undefined ? '' : await current.Body.transformToString();
      if (currentBody !== options.ifMatch) throw new PreconditionFailed();
      command.IfMatch = current.ETag;
    }
    try {
      await client.send(new PutObjectCommand(command));
    } catch (error: unknown) {
      if (isS3Precondition(error)) throw new PreconditionFailed();
      throw error;
    }
  },
  delete: async (key) => {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
  listPrefix: async (prefix) => {
    const keys: string[] = [];
    let continuation: string | undefined;
    do {
      const page = await listPage(client, bucket, prefix, continuation);
      keys.push(...page.keys);
      continuation = page.next;
    } while (continuation !== undefined);
    return keys.sort(compareStrings);
  },
});
