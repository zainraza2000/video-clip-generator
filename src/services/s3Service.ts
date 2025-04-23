import {
    DeleteObjectCommand,
    PutObjectCommand,
    S3Client,
    GetObjectCommand,
  } from "@aws-sdk/client-s3";
  import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
  import { config } from "dotenv";
  import crypto from "crypto";
  
  config();
  
  export const getRandomFileName = (bytes = 32) =>
    crypto.randomBytes(bytes).toString("hex");
  
  const bucket_name = process.env.BUCKET_NAME!;
  const bucket_region = process.env.BUCKET_REGION!;
  const bucket_access_key = process.env.AWS_BUCKET_ACCESS_KEY_ID!;
  const bucket_secret_key = process.env.AWS_BUCKET_SECRET_ACCESS_KEY!;
  
  const s3Client = new S3Client({
    region: bucket_region,
    credentials: {
      accessKeyId: bucket_access_key,
      secretAccessKey: bucket_secret_key,
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
      Bucket: bucket_name,
      Key: filename,
      Body: buffer,
      ContentType: mimeType,
    });
  
    const response = await s3Client.send(command);
    return { response, filename };
  };
  
  export const removeFile = async (filename: string) => {
    const command = new DeleteObjectCommand({
      Bucket: bucket_name,
      Key: filename,
    });
    await s3Client.send(command);
  };
  
  export const getImageUrl = async (filename: string) => {
    const command = new GetObjectCommand({
      Bucket: bucket_name,
      Key: filename,
    });
  
    // URL expires in 1 hour
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return signedUrl;
  };
  