// Turns the single-file build into the page-body format used for hosting:
// strips the <!doctype>/<html>/<head>/<body> wrapper (the host adds its own)
// and keeps <title>, styles, the inlined script and the app root.
// Inlined libraries contain literal "<head>"/"<body>" strings, so the real tags
// are located structurally: the last </head>, and the <body> after it.
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist-artifact/index.html', 'utf8');
const headStart = html.indexOf('<head>') + '<head>'.length;
const headEnd = html.lastIndexOf('</head>');
const bodyStart = html.indexOf('<body>', headEnd) + '<body>'.length;
const bodyEnd = html.lastIndexOf('</body>');
const head = html.slice(headStart, headEnd);
const body = html.slice(bodyStart, bodyEnd);
const titleMatch = head.match(/<title>[^<]*<\/title>/);
const rest = head
  .replace(titleMatch[0], '')
  .replace(/<meta charset="UTF-8"\s*\/?>/, '')
  .replace(/<meta name="viewport"[^>]*>/, '');
const page = `${titleMatch[0]}\n${rest.trim()}\n${body.trim()}\n`;
if (!page.includes('id="root"')) throw new Error('app root missing from output');
writeFileSync('dist-artifact/wasteless.html', page);
console.log('wrote dist-artifact/wasteless.html', (page.length / 1024).toFixed(0), 'KB');
