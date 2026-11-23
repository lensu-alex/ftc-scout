import { createWorker, PSM, type Worker } from "tesseract.js";
import { crop, toOcrImage, type Frame } from "../src/vision/frame";
import { timerDigits, type ScoreBar } from "../src/vision/overlay";
import { parseClock, parseMatchName, type MatchName } from "../src/vision/ocr";

// Dev only: Tesseract-based overlay reader, used to label data for the tiny reader's templates.

type Encode = (f: Frame) => unknown | Promise<unknown>;

export class OverlayReader {
  private digits?: Worker;
  private text?: Worker;

  /** `encode` turns a Frame into something tesseract.js accepts (ImageData in the browser, a PNG buffer in Node). */
  private encode: Encode;
  constructor(encode: Encode) {
    this.encode = encode;
  }

  async init() {
    this.digits = await createWorker("eng");
    await this.digits.setParameters({ tessedit_char_whitelist: "0123456789:", tessedit_pageseg_mode: PSM.SINGLE_LINE });
    this.text = await createWorker("eng");
    await this.text.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  }

  async close() {
    await this.digits?.terminate();
    await this.text?.terminate();
  }

  /** Seconds left on the match clock, or null if unreadable. */
  async readClock(f: Frame, bar: ScoreBar): Promise<number | null> {
    const img = toOcrImage(crop(f, timerDigits(bar.timer)), scaleFor(bar.timer.h * 0.66, 70), true);
    const { data } = await this.digits!.recognize((await this.encode(img)) as ImageData);
    return parseClock(data.text);
  }

  async readMatchName(f: Frame, bar: ScoreBar): Promise<MatchName | null> {
    const img = toOcrImage(crop(f, bar.matchName), scaleFor(bar.matchName.h, 60), false);
    const { data } = await this.text!.recognize((await this.encode(img)) as ImageData);
    return parseMatchName(data.text);
  }
}

function scaleFor(h: number, target: number) {
  return Math.max(1, Math.min(4, target / Math.max(1, h)));
}
