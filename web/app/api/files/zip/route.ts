import archiver from "archiver";
import { NextResponse } from "next/server";
import { Readable } from "stream";

// Download gabungan beberapa file (dari Cloudinary) jadi satu .zip
export async function POST(req: Request) {
  const { urls } = (await req.json()) as { urls: string[] };

  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk) => chunks.push(chunk));

  for (const url of urls) {
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = url.split("/").pop() ?? `file-${Date.now()}`;
    archive.append(buffer, { name: filename });
  }

  await archive.finalize();
  const zipBuffer = Buffer.concat(chunks);

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=export-bundle.zip",
    },
  });
}
