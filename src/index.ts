// Application entry point
import {processVideoRequest } from './app';
import { logger } from './utils/logger';


async function main() {
  try {

    const exampleurl = {
      videoUrl: 'https://drive.usercontent.google.com/download?id=1NoPnFvfAd-0xUGBaytbvknYvtPT18b5K&export=download&authuser=0&confirm=t&uuid=f99187ad-41fc-41c2-bcce-01734629f3f3&at=APcmpoxZ6KRtQ8CJtoXhK3Kmgb70:1745331088612',
    };
    

    const result = await processVideoRequest(exampleurl);
    logger.info('Processing completed', { 
      status: result.status,
      hasTranscript: result.data?.transcript ? 'yes' : 'no',
      hasScreenshot: result.data?.screenshot ? 'yes' : 'no' 
    });

    if (result.data?.screenshot) {
      logger.info('Screenshot saved at', {
        screenshotPath: result.data.screenshot 
      });
    }
    

    if (result.data?.transcript) {
      const transcript = result.data.transcript;
      

      // logger.info('Transcript text', { text: transcript.text });
      

      // if (transcript.words && transcript.words.length > 0) {
        
      if (transcript.utterances && transcript.utterances.length > 0) {

        // for (const word of transcript.words) {
        //   console.log(
        //     `Word: ${word.text}, Start: ${word.start}, End: ${word.end}, Confidence: ${word.speaker}`
        //   );
        // }
        for (const utterance of transcript.utterances) {

          const startTime = utterance.start;
          const endTime = utterance.end;
          console.log(`Speaker ${utterance.speaker} (${startTime} - ${endTime}): ${utterance.text}`);

          // console.log(`Speaker ${utterance.speaker}: ${utterance.text}`)
          }
      } else {
        logger.info('No word-level details available');
      }
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Application failed', { error: errorMessage });
    process.exit(1);
  }
}


if (require.main === module) {
  main();
}


export { main };