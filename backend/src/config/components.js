const components = {
  issuers: [
    {
      id: "inji-certify",
      name: "Inji Certify",
      type: "issuer",
      version: "0.14.0",
      baseUrl: process.env.INJI_CERTIFY_URL,
      protocols: ["openid4vci"],
      credentialFormats: ["ldp_vc", "sd_jwt_vc", "mso_mdoc"],
      issuanceFlows: ["authorization_code", "pre_authorized_code"]
    }
  ],

  wallets: [
    {
      id: "inji-mobile",
      name: "Inji Mobile Wallet",
      type: "wallet",
      platforms: ["android", "ios"],
      protocols: ["openid4vci", "openid4vp"]
    },
    {
      id: "inji-web",
      name: "Inji Web Wallet",
      type: "wallet",
      platforms: ["web"],
      protocols: ["openid4vci", "openid4vp"]
    }
  ],

  verifiers: [
    {
      id: "inji-verify",
      name: "Inji Verify",
      type: "verifier",
      version: "0.18.2",
      baseUrl: process.env.INJI_VERIFY_URL,
      clientId: process.env.INJI_VERIFY_CLIENT_ID?.trim(),
      protocols: ["openid4vp"]
    }
  ]
};

module.exports = components;