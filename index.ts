// /api/index.ts — 2List Redirect Root Info Page
export const config = { runtime: 'edge' };

export default async function handler() {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>2-List Redirect Service</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background: #faf9f7;
          color: #222;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          text-align: center;
        }
        h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
        p { max-width: 400px; font-size: 1rem; color: #555; }
        a { color: #a6795d; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1>2-List Redirect Service</h1>
      <p>This service securely forwards product links from the 2-List App to our partner shops.</p>
      <p>If you see this page directly, you probably opened the redirect URL without parameters.</p>
      <p><a href="https://2list.app">Learn more about 2-List</a></p>
    </body>
    </html>
  `;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
