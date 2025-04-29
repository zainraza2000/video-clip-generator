import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ReceiveMessageRequest } from '@aws-sdk/client-sqs';
import { AWS_SQS_QUEUE_URL } from '../config';

const sqs = new SQSClient({ region: 'your-region' });

export async function retrieveMessages() {
  try {
    const receiveParams: ReceiveMessageRequest = {
      QueueUrl: AWS_SQS_QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
    };

    const data = await sqs.send(new ReceiveMessageCommand(receiveParams));

    if (data.Messages && data.Messages.length > 0) {
      return data.Messages;
    }
  } catch (error) {
    console.error("Error receiving or processing message:", error);
  }
  return [];
}

export async function deleteMessage(handle: string) {
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: AWS_SQS_QUEUE_URL,
      ReceiptHandle: handle,
    })
  );
}
