// Builds public/index.html from app/fleet-operations.html (the app as it was published on claude.ai).
// To update the app later: replace app/fleet-operations.html with the new version and push; Vercel runs this on every deploy.
import fs from "node:fs";
const src = fs.readFileSync(new URL("../app/fleet-operations.html", import.meta.url), "utf8");
const swaps = [
  ["Linked Claude account", "Linked login"],
  ["Unnamed Claude account", "Unnamed login"],
  ["Sign in to Claude to use this app.", "Sign in to use this app."],
  ["Your Claude account isn't linked to a user in the user master yet.", "Your login isn't linked to a user in the user master yet."],
  ["Not linked to a Claude account", "Not linked to a login"],
  ["You may only have view access to this page; ask the owner to share it with you as a Contributor.", "Check your connection and try again."],
  ["File storage can only be read by someone with edit access, in the app opened from claude.ai.", "File storage can only be read by an approved user."],
  ["Open the app from claude.ai to see this", "Available to approved users"],
  [" Open the app from claude.ai to print the slip.", " Reload the page and try again."],
  [" Open the app from claude.ai.", " Reload the page and try again."]
];
let html = src, missing = [];
for (const [a, b] of swaps) { if (!html.includes(a)) missing.push(a); html = html.split(a).join(b); }
if (missing.length) console.warn("Text not found (the app may have changed):\n  " + missing.join("\n  "));
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#18212b">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>[hidden]{display:none!important}</style>
<script src="/claude-shim.js"></script>
</head>
<body>
`;
fs.writeFileSync(new URL("../public/index.html", import.meta.url), head + html + "\n</body>\n</html>\n");
console.log("public/index.html written");
