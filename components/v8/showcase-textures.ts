import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
} from "three";

/** Fine physical surface detail, kept separate from the interface's flat colors. */
export function mobileSurfaceTexture(
  kind: "paint" | "rubber" | "brushed" | "plate",
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = kind === "plate" ? 192 : 512;
  const context = canvas.getContext("2d")!;
  let seed = 2057;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  if (kind === "plate") {
    context.fillStyle = "#d6d9d9";
    context.fillRect(0, 0, 512, 192);
    context.fillStyle = "#303b42";
    context.font = "600 36px sans-serif";
    context.fillText("AMR / 02", 64, 58);
    context.font = "16px monospace";
    context.fillText("MOBILE ROBOT · 24V DC", 64, 91);
    context.fillText("S/N  026-0018", 64, 121);
    for (let x = 64; x < 365; x += 5)
      context.fillRect(x, 143, 1 + Math.floor(random() * 3), 24);
  } else {
    const pixels = context.createImageData(512, 512);
    for (let y = 0; y < 512; y++) {
      const brushed = (random() - 0.5) * 35;
      for (let x = 0; x < 512; x++) {
        const value =
          kind === "brushed"
            ? 175 + brushed + random() * 8
            : kind === "rubber"
              ? 158 + random() * 58
              : 188 + random() * 18;
        const i = (y * 512 + x) * 4;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
        pixels.data[i + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    if (kind === "rubber") {
      context.strokeStyle = "#777777";
      context.lineWidth = 1.2;
      for (let y = 8; y < 512; y += 24) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(512, y + 12);
        context.stroke();
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = kind === "plate" ? SRGBColorSpace : NoColorSpace;
  texture.anisotropy = 8;
  if (kind !== "plate") {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.setScalar(kind === "paint" ? 3 : 1);
  }
  return texture;
}

/** Original surface detail generated at runtime; no image backgrounds or UI gradients. */
export function showcaseTexture(
  kind: "concrete" | "cardboard" | "label" | "contact",
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = kind === "label" ? 256 : 512;
  const context = canvas.getContext("2d")!;
  let seed = 713;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  if (kind === "contact") {
    const pixels = context.createImageData(512, 512);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const d = Math.pow((x - 256) / 190, 2) + Math.pow((y - 256) / 190, 2);
        pixels.data[(y * 512 + x) * 4 + 3] = Math.round(
          140 * Math.exp(-d * 2.8) * Math.max(0, 1 - d / 2),
        );
      }
    context.putImageData(pixels, 0, 0);
  } else if (kind === "label") {
    context.fillStyle = "#e9e6da";
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = "#3c4141";
    context.font = "bold 25px monospace";
    context.fillText("R / 0248", 24, 46);
    context.font = "13px monospace";
    context.fillText("CONTROLLED STORAGE", 24, 72);
    let x = 24;
    while (x < 230) {
      const width = 1 + Math.floor(random() * 4);
      context.fillRect(x, 105, width, 74);
      x += width + 1 + Math.floor(random() * 3);
    }
    context.font = "16px monospace";
    context.fillText("0 248 720 019", 32, 209);
  } else {
    const pixels = context.createImageData(512, 512);
    const base = kind === "concrete" ? [173, 179, 181] : [164, 128, 85];
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const value =
          (random() - 0.5) * (kind === "concrete" ? 19 : 27) +
          Math.sin(x * 0.025) * Math.cos(y * 0.04) * 4;
        const i = (y * 512 + x) * 4;
        for (let c = 0; c < 3; c++) pixels.data[i + c] = base[c] + value;
        pixels.data[i + 3] = 255;
      }
    context.putImageData(pixels, 0, 0);
    context.strokeStyle = kind === "concrete" ? "#ffffff09" : "#4b2e1320";
    context.lineWidth = 0.5;
    for (let i = 0; i < 220; i++) {
      const x = random() * 512,
        y = random() * 512;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + random() * 35, y + random() * 3);
      context.stroke();
    }
    if (kind === "cardboard") {
      context.strokeStyle = "#5b3f1f55";
      context.lineWidth = 2;
      context.strokeRect(2, 2, 508, 508);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (kind === "concrete" || kind === "cardboard") {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.setScalar(kind === "concrete" ? 6 : 1);
  }
  texture.anisotropy = 4;
  return texture;
}
