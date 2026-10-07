const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { runCultureShift } = require("./cultureshift");

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 100000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

const candidates = [
  {
    id: "E7EBD7F6-5B44-4AEB-BEA0-92317FD35BC3",
    name: "Ravi Shankar",
    scope: 2
  },
  {
    id: "B44BC27C-9617-41F8-9143-C9C7B499543A",
    name: "Anoushka Shankar",
    scope: 2
  },
  {
    id: "9986F595-C20E-4EBB-828F-55E7DEEBE448",
    name: "A.R. Rahman",
    scope: 2
  }
];

const audienceSignals = {
  bts: "F347D506-CB6F-46FA-9A8B-AFBC31C71A1A",
  metallica: "C445C761-CB38-4FEE-B085-D35F444A04DF"
};

const preserveTags = {
  classical: "urn:tag:genre:music:indian_classical",
  sitar: "urn:tag:instrument:qloo:sitar"
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || "127.0.0.1"}`
  );

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/evaluate"
  ) {
    try {
      const body = await readJsonBody(req);

      const audienceSignal = audienceSignals[body.audience];

      if (!audienceSignal) {
        sendJson(res, 400, {
          error: "Unsupported audience."
        });
        return;
      }

      const requestedPreserveTags = [];

      if (body.preserveClassical) {
        requestedPreserveTags.push(preserveTags.classical);
      }

      if (body.preserveSitar) {
        requestedPreserveTags.push(preserveTags.sitar);
      }

      const result = await runCultureShift({
        candidates,
        optionType: "artist",
        audienceSignals: [audienceSignal],
        preserveTags: requestedPreserveTags
      });

      sendJson(res, 200, result);
    } catch (error) {
      console.error("CultureShift evaluation failed:", error);

      sendJson(res, 500, {
        error: "CultureShift evaluation failed."
      });
    }

    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    res.end("Method not allowed");
    return;
  }

  let requestPath =
    requestUrl.pathname === "/"
      ? "/index.html"
      : requestUrl.pathname;

  const relativePath = requestPath.replace(/^\/+/, "");

  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (
    filePath !== PUBLIC_DIR &&
    !filePath.startsWith(PUBLIC_DIR + path.sep)
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath);

    res.writeHead(200, {
      "Content-Type":
        contentTypes[extension] || "application/octet-stream"
    });

    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `CultureShift AI running at http://127.0.0.1:${PORT}`
  );
});