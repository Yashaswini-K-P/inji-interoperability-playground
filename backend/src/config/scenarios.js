const scenarioDefaults = {
  credentialFormats: [
    "ldp_vc",
    "sd_jwt_vc",
    "mso_mdoc"
  ],

  issuanceProtocols: [
    "openid4vci"
  ],

  presentationProtocols: [
    "openid4vp"
  ],

  issuanceFlows: [
    "authorization_code",
    "pre_authorized_code"
  ]
};

module.exports = scenarioDefaults;