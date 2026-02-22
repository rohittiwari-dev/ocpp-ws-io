import { promises as fs } from "node:fs";
import { stat } from "node:fs/promises";
import * as http from "node:http";
import { extname, join } from "node:path";
import pc from "picocolors";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function otaCommand(dir: string, options: { port?: number }) {
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Local Firmware Hosting Server (OTA)`));

  const targetDir = join(process.cwd(), dir || ".");
  const port = Number(options.port || 4000);

  try {
    const dirStat = await stat(targetDir);
    if (!dirStat.isDirectory()) throw new Error("Target is not a directory");
  } catch (_err) {
    console.error(pc.red(`Error: Firmware directory '${dir}' does not exist.`));
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    try {
      // Prevent directory traversal attacks
      const securePath = join(targetDir, req.url || "/").replace(/\\/g, "/");
      if (!securePath.startsWith(targetDir.replace(/\\/g, "/"))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const fileStat = await stat(securePath);

      if (fileStat.isDirectory()) {
        // Render a simple directory index
        const files = await fs.readdir(securePath);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("<h1>Firmware Listing</h1><ul>");

        // Derive a safe base path from the request URL (path only, normalized)
        let basePath = "/";
        if (req.url && req.url !== "/") {
          const qIndex = req.url.indexOf("?");
          const rawPath =
            qIndex === -1 ? req.url : req.url.substring(0, qIndex);
          basePath = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
          if (!basePath.startsWith("/")) {
            basePath = `/${basePath}`;
          }
        }

        for (const f of files) {
          const encodedName = encodeURIComponent(f);
          const safeBasePath = escapeHtml(basePath);
          const safeLabel = escapeHtml(f);
          res.write(
            `<li><a href="${safeBasePath}/${encodedName}">${safeLabel}</a></li>`,
          );
        }
        res.write("</ul>");
        res.end();
        console.log(pc.gray(`[GET] ${req.url} (Directory Listing)`));
        return;
      }

      const fileSize = fileStat.size;
      const range = req.headers.range;

      // Determine Content Type
      const ext = extname(securePath).toLowerCase();
      let contentType = "application/octet-stream"; // Default for .bin files
      if (ext === ".tar.gz" || ext === ".tgz") contentType = "application/gzip";
      if (ext === ".zip") contentType = "application/zip";
      if (ext === ".json") contentType = "application/json";

      // EV Chargers strictly require Accept-Ranges and Content-Length headers
      if (range) {
        // Handle Range requests (Chunked OTA downloads)
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
          res.writeHead(416, {
            "Content-Range": `bytes */${fileSize}`,
          });
          res.end();
          return;
        }

        const chunksize = end - start + 1;
        const fileHandle = await fs.open(securePath, "r");
        const stream = fileHandle.createReadStream({ start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": contentType,
        });

        console.log(pc.cyan(`[PARTIAL] ${req.url} (${start}-${end})`));
        stream.pipe(res);
        stream.on("end", () => fileHandle.close());
      } else {
        // Handle full downloads
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Accept-Ranges": "bytes",
          "Content-Type": contentType,
        });

        if (req.method === "HEAD") {
          console.log(pc.gray(`[HEAD] ${req.url} (${fileSize} bytes)`));
          res.end();
        } else {
          console.log(pc.blue(`[DOWNLOAD] ${req.url} (${fileSize} bytes)`));
          const fileHandle = await fs.open(securePath, "r");
          const stream = fileHandle.createReadStream();
          stream.pipe(res);
          stream.on("end", () => fileHandle.close());
        }
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        res.writeHead(404);
        res.end("Firmware module not found");
      } else {
        res.writeHead(500);
        res.end("Internal Server Error");
        console.error(pc.red(`Error serving file: ${err.message}`));
      }
    }
  });

  server.listen(port, () => {
    console.log(pc.gray(`Hosting files from: ${targetDir}`));
    console.log(pc.green(`✔ OTA Server listening at http://localhost:${port}`));
    console.log(
      pc.yellow(`Use this URL in your 'UpdateFirmware' OCPP requests.`),
    );
  });

  process.on("SIGINT", () => {
    console.log(pc.yellow(`\nShutting down OTA API...`));
    server.close();
    process.exit(0);
  });
}
