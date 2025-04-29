// Application entry point
import { logger } from "./utils/logger";
import { runPipeline } from "./pipeline";

async function main() {
  try {
    // const messages = await retrieveMessages()
    const messages = [
      {
        Body: JSON.stringify({
          videos: [
            {
              url: "https://rr2---sn-hju7enel.googlevideo.com/videoplayback?expire=1745858362&ei=2loPaOP8DL280_wPo_qyiQc&ip=38.7.131.198&id=o-AONMs0Y-VY3dP7jll_Tblv6vxfBNGP1gyhoA92jf_WQv&itag=18&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ%3D%3D&bui=AecWEAaDFOevyDJtJhsKL1IZSNejiocM955o7i8Ku_EPuAoTJtBFj1MAQyDY8LAUBqiljoF8R0QHx9AP&vprv=1&svpuc=1&mime=video%2Fmp4&ns=aUoypFytWhkcdQtfG8p5oj0Q&rqh=1&cnr=14&ratebypass=yes&dur=79.063&lmt=1708730951519007&lmw=1&fexp=24350590,24350737,24350827,24350961,24351173,24351429,24351431,24351495,24351528,24351542,24351545,24351638,24351658,24351661,24351662,24351672,24351704,24351757,24351768,51466643&c=TVHTML5&sefc=1&txp=4538434&n=haRfk3UxZV72Iw&sparams=expire%2Cei%2Cip%2Cid%2Citag%2Csource%2Crequiressl%2Cxpc%2Cbui%2Cvprv%2Csvpuc%2Cmime%2Cns%2Crqh%2Ccnr%2Cratebypass%2Cdur%2Clmt&sig=AJfQdSswRQIgBNqKk-lSnvnfdhhcApvW6h4pijIEDdKZgN4pCv4VnTMCIQCxw2KumXC9xAznvY6t8gJbrgzoYg-DirtGG9rYV0TNWA%3D%3D&title=Ed%27s%20Heinz%20Ad&rm=sn-fhnxg8pjx-nupl7e,sn-hp5ye7z&rrc=79,104&req_id=1caaf2da5e28a3ee&cmsv=e&rms=rdu,au&redirect_counter=2&cms_redirect=yes&ipbypass=yes&met=1745855802,&mh=6C&mip=103.244.179.55&mm=29&mn=sn-hju7enel&ms=rdu&mt=1745855352&mv=m&mvi=2&pl=24&lsparams=ipbypass,met,mh,mip,mm,mn,ms,mv,mvi,pl,rms&lsig=ACuhMU0wRQIhAL2URETCa4wLWA4o7EdehqIHfAXd0TQ5qAcfEP_fzxX7AiBcEoNBRS335nadhUKlldzUsMHgY7HeQfgoYfy6mGj7lQ%3D%3D",
            },
          ],
        }),
      },
    ];
    // while (true) {
    for (const message of messages) {
      try {
        if (message.Body) {
          await runPipeline(message);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        logger.error("Application failed", { error: errorMessage });
        continue;
      } finally {
      }
    }
    // }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Application failed", { error: errorMessage });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { main };
