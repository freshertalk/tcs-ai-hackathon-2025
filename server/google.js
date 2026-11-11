"use strict";
// Google's OAuth 2.0 authorization-code flow, kept behind a two-method
// interface so tests can swap in a fake and never touch the network.
//
//   authUrl({ state, nonce })  -> URL to send the browser to
//   exchange(code)             -> { email, emailVerified, name, picture, nonce }
//
// The client secret is used here, on the server, and nowhere else.

const { OAuth2Client } = require("google-auth-library");

module.exports = function makeGoogle(clientId, clientSecret, redirectUri) {
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);

  return {
    authUrl({ state, nonce }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        prompt: "select_account",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },

    async exchange(code) {
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error("no id_token returned");
      // verifyIdToken checks the signature, issuer, expiry and audience
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      const p = ticket.getPayload() || {};
      return {
        email: String(p.email || ""),
        emailVerified: p.email_verified === true,
        name: String(p.name || ""),
        picture: String(p.picture || ""),
        nonce: String(p.nonce || ""),
      };
    },
  };
};
