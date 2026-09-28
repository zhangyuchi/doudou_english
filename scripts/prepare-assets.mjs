import { cp, mkdir } from "node:fs/promises";

// This script owns public/pdfjs; Vite alone owns the final dist tree.
await mkdir("public/pdfjs", { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(`node_modules/pdfjs-dist/${name}`, `public/pdfjs/${name}`, {
    recursive: true,
  });
}
