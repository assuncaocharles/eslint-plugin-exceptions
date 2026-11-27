const HEADER_END = Buffer.from("\r\n\r\n");

/**
 * Read LSP messages (`Content-Length` framed JSON-RPC) from a stream.
 * Calls `onMessage(message, raw)` for each complete message. `raw` is the
 * original JSON body as a Buffer, so messages can be forwarded untouched.
 */
function readMessages(stream, onMessage) {
  let buffer = Buffer.alloc(0);

  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf(HEADER_END);
      if (headerEnd === -1) return;

      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Not a valid header: drop it and resync on the next one
        buffer = buffer.subarray(headerEnd + HEADER_END.length);
        continue;
      }

      const start = headerEnd + HEADER_END.length;
      const end = start + Number(match[1]);
      if (buffer.length < end) return;

      const raw = buffer.subarray(start, end);
      buffer = buffer.subarray(end);

      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        message = null;
      }
      onMessage(message, raw);
    }
  });
}

function writeRaw(stream, raw) {
  stream.write(`Content-Length: ${raw.length}\r\n\r\n`);
  stream.write(raw);
}

function writeMessage(stream, message) {
  writeRaw(stream, Buffer.from(JSON.stringify(message), "utf8"));
}

module.exports = { readMessages, writeMessage, writeRaw };
