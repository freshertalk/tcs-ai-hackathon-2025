// Development only (npm start). Forwards /api to the Node server so the React
// dev server and the API share one origin — which is what lets the session
// cookie and the Google redirect work exactly as they do in production.
//
//   terminal 1:  npm run server     (API on :5000)
//   terminal 2:  npm start          (site on :3000, /api → :5000)
//
// This proxies every request, including browser navigations, which is why it
// is used instead of the "proxy" field in package.json (that one ignores
// requests that accept text/html — the Google redirect among them).

const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function setupProxy(app) {
  app.use(
    createProxyMiddleware("/api", {
      target: process.env.API_TARGET || "http://localhost:5000",
      changeOrigin: false, // keep Host as localhost:3000 so redirect URIs match
      logLevel: "warn",
    })
  );
};
