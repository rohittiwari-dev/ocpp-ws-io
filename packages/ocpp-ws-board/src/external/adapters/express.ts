import { once } from "node:events";
import type { ServerResponse } from "node:http";
import type { BoardIncomingMessage } from "../../types/operations.js";
import { createBoard } from "../board.js";
import type { BoardOptions } from "../types.js";

/** Node/Express middleware; mount at options.basePath when using a URL prefix. */
export function expressAdapter(options: BoardOptions) {
  const board = createBoard(options);
  const handler = async (req: BoardIncomingMessage, res: ServerResponse) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value))
          for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      const origin = `${"encrypted" in req.socket && req.socket.encrypted ? "https" : "http"}://${req.headers.host ?? "localhost"}`;
      let body: string | undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.body !== undefined) {
          const encoded = JSON.stringify(req.body);
          if (Buffer.byteLength(encoded) > 1048576) {
            res.statusCode = 413;
            res.end("Request body too large");
            return;
          }
          body = encoded;
        } else {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(String(chunk));
            length += buffer.length;
            if (length > 1048576) {
              res.statusCode = 413;
              res.end("Request body too large");
              return;
            }
            chunks.push(buffer);
          }
          body = Buffer.concat(chunks).toString("utf-8");
        }
      }
      const request = new Request(new URL(req.url ?? "/", origin), {
        method: req.method,
        headers,
        body,
      });
      const response = await board.app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      if (!response.body) {
        res.end();
        return;
      }
      const reader = response.body.getReader();
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      res.once("close", abort);
      try {
        while (!res.destroyed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) {
            const abortWait = new AbortController();
            try {
              await Promise.race([
                once(res, "drain", { signal: abortWait.signal }),
                once(res, "close", { signal: abortWait.signal }),
              ]);
            } finally {
              abortWait.abort();
            }
          }
        }
      } finally {
        res.off("close", abort);
        await reader.cancel().catch(() => {});
      }
      res.end();
    } catch {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  };
  return { ...board, handler };
}
