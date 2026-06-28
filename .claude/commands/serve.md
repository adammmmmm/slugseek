---
description: Serve index.html locally over HTTP so the live DNS/RDAP/Datamuse fetches work, and report the URL to open.
argument-hint: "[port]"
allowed-tools: Bash, Read
---
Start a local static server for SlugSeek so its live availability checks work
(opening `index.html` from `file://` is blocked by CORS/CSP and shows the
"network blocked" banner).

Steps:
1. Pick a port: use `$ARGUMENTS` if given, else `8080`.
2. Launch a static server rooted at the project dir in the background, e.g.
   `npx --yes serve -l <port> .` (fall back to `python -m http.server <port>` if
   npx is unavailable).
3. Print the URL to open (`http://localhost:<port>/`) and remind the user that a
   localhost origin is enough for the public APIs to respond; for a full check
   over real HTTPS, deploy per `DEPLOY.md`.
4. Do NOT block waiting; run the server in the background and hand back the URL.
