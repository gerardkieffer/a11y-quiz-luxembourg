import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

app.disable("x-powered-by");

// Static site with no inline scripts/styles and no runtime fetches beyond
// same-origin JSON, so a strict CSP is safe here.
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(port, () => {
  console.log(`Quiz accessibilite disponible sur http://localhost:${port}`);
});
