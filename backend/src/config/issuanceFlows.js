const issuanceFlows = {
  authorization_code: {
    id: "authorization_code",
    name: "Authorization Code",
    protocol: "openid4vci"
  },

  pre_authorized_code: {
    id: "pre_authorized_code",
    name: "Pre-Authorization Code",
    protocol: "openid4vci"
  }
};

module.exports = issuanceFlows;