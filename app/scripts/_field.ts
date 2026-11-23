import { fieldHomography, toField } from "../src/vision/field";
// a trapezoid like a low camera: near edge wide, far edge narrow; clicked in a random order
const h = fieldHomography([{ x: 900, y: 300 }, { x: 100, y: 600 }, { x: 380, y: 300 }, { x: 1180, y: 600 }])!;
for (const p of [{ x: 100, y: 600 }, { x: 380, y: 300 }, { x: 900, y: 300 }, { x: 1180, y: 600 }, { x: 640, y: 450 }])
  console.log(p, "→", Object.values(toField(h, p)).map(v => v.toFixed(2)).join(", "));
