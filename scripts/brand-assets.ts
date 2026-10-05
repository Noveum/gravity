import { writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { gravityIdentity as identity } from "../packages/brand/identity";
import t from "../packages/i18n/translations/en.json";
import { GravityMark } from "../src/components/gravity-logo";

const shape = (color: string) =>
  `<path d="${identity.path}" stroke="${color}" stroke-width="${identity.strokeWidth}" stroke-linejoin="round"/><circle cx="64" cy="64" r="${identity.coreRadius}" fill="${color}"/>`;
const svg = (color: string, adaptive = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><title>${t.brand}</title>${adaptive ? `<style>:root{color:${identity.light}}@media(prefers-color-scheme:dark){:root{color:${identity.dark}}}</style>` : ""}${shape(color)}</svg>\n`;
const png = async (size: number, tile = false) =>
  Buffer.from(
    await new ImageResponse(
      createElement(
        "div",
        {
          style: {
            display: "flex",
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            ...(tile ? { background: identity.light } : {}),
          },
        },
        createElement(GravityMark, {
          size: tile ? Math.round((size * 2) / 3) : size,
          color: tile ? identity.inverse : identity.light,
        }),
      ),
      { width: size, height: size },
    ).arrayBuffer(),
  );

// ICO images contain lossless RGBA PNGs with explicit offsets and dimensions.
const resolutions = [16, 32, 48, 64];
const images = await Promise.all(resolutions.map((size) => png(size)));
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (const [index, bytes] of images.entries()) {
  const entry = 6 + index * 16;
  header[entry] = resolutions[index];
  header[entry + 1] = resolutions[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
}
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...images]));
await writeFile("src/app/icon.svg", svg("currentColor", true));
await writeFile("public/brand/gravity-mark.svg", svg(identity.light));
await writeFile("public/brand/gravity-mark-dark.svg", svg(identity.dark));
for (const size of [192, 512])
  await writeFile(
    `public/brand/gravity-app-${size}.png`,
    await png(size, true),
  );
console.log(
  "Exported shared Gravity mark, adaptive SVG, multi-size favicon and app icons.",
);
