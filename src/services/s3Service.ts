import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import {
  AWS_ACCESS_KEY_ID,
  AWS_BUCKET_NAME,
  AWS_REGION,
  AWS_SECRET_ACCESS_KEY,
} from "../config";

export const getRandomFileName = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("hex");

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

export const uploadFile = async ({
  buffer,
  originalName,
  mimeType,
}: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}) => {
  const filename = `uploads/${getRandomFileName()}-${originalName}`;

  const command = new PutObjectCommand({
    Bucket: AWS_BUCKET_NAME,
    Key: filename,
    Body: buffer,
    ContentType: mimeType,
  });

  const response = await s3Client.send(command);

  const getCommand = new GetObjectCommand({
    Bucket: AWS_BUCKET_NAME,
    Key: filename,
  });

  const signedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

  return signedUrl;
};

export const removeFiles = async (keys: string[]) => {
  const command = new DeleteObjectsCommand({
    Bucket: AWS_BUCKET_NAME,
    Delete: { Objects: keys.map((Key) => ({ Key })) },
  });
  await s3Client.send(command);
};

export const getImageUrl = async (filename: string) => {
  const command = new GetObjectCommand({
    Bucket: AWS_BUCKET_NAME,
    Key: filename,
  });

  // URL expires in 1 hour
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return signedUrl;
};
