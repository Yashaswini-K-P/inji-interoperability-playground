const DEFAULT_PROTOCOL = "openid4vp://";

const VP_FORMATS = {
  ldp_vp: {
    proof_type: [
      "Ed25519Signature2018",
      "Ed25519Signature2020",
      "RsaSignature2018"
    ]
  },
  "vc+sd-jwt": {
    "sd-jwt_alg_values": ["RS256", "ES256", "ES256K", "EdDSA"],
    "kb-jwt_alg_values": ["RS256", "ES256", "ES256K", "EdDSA"]
  }
};

function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

function requireHttpUrl(value, fieldName) {
  requireString(value, fieldName);

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch (error) {
    throw new Error(`${fieldName} must be an absolute HTTP(S) URL`);
  }

  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error(`${fieldName} must be an absolute HTTP(S) URL`);
  }

  return value;
}

function createAuthorizationRequestUri(
  verifierResponse,
  clientId
) {
  requireString(clientId, "INJI_VERIFY_CLIENT_ID");

  if (
    !verifierResponse ||
    typeof verifierResponse !== "object" ||
    Array.isArray(verifierResponse)
  ) {
    throw new Error("Verifier response must be an object");
  }

  const requestId = requireString(
    verifierResponse.requestId,
    "requestId"
  );
  const params = new URLSearchParams();

  params.set("client_id", clientId);

  if (verifierResponse.requestUri !== undefined) {
    const requestUri = requireHttpUrl(
      verifierResponse.requestUri,
      "requestUri"
    );

    params.set("request_uri", requestUri);
  } else {
    const authorizationDetails =
      verifierResponse.authorizationDetails;

    if (
      !authorizationDetails ||
      typeof authorizationDetails !== "object" ||
      Array.isArray(authorizationDetails)
    ) {
      throw new Error(
        "authorizationDetails or requestUri is required"
      );
    }

    const responseClientId = requireString(
      authorizationDetails.clientId,
      "authorizationDetails.clientId"
    );

    if (responseClientId !== clientId) {
      throw new Error(
        "Verifier response clientId does not match INJI_VERIFY_CLIENT_ID"
      );
    }

    params.set("state", requestId);
    params.set(
      "response_type",
      requireString(
        authorizationDetails.responseType,
        "authorizationDetails.responseType"
      )
    );
    params.set(
      "response_mode",
      requireString(
        authorizationDetails.responseMode,
        "authorizationDetails.responseMode"
      )
    );
    params.set(
      "nonce",
      requireString(
        authorizationDetails.nonce,
        "authorizationDetails.nonce"
      )
    );
    params.set(
      "response_uri",
      requireHttpUrl(
        authorizationDetails.responseUri,
        "authorizationDetails.responseUri"
      )
    );

    const definitionUri =
      authorizationDetails.presentationDefinitionUri;
    const definition =
      authorizationDetails.presentationDefinition;

    if (definitionUri !== undefined && definition !== undefined) {
      throw new Error(
        "Verifier response must include only one presentation definition form"
      );
    }

    if (definitionUri !== undefined) {
      params.set(
        "presentation_definition_uri",
        requireHttpUrl(
          definitionUri,
          "authorizationDetails.presentationDefinitionUri"
        )
      );
    } else if (
      definition &&
      typeof definition === "object" &&
      !Array.isArray(definition)
    ) {
      params.set(
        "presentation_definition",
        JSON.stringify(definition)
      );
    } else {
      throw new Error(
        "authorizationDetails must include a presentationDefinition or presentationDefinitionUri"
      );
    }

    const clientMetadata =
      authorizationDetails.clientMetadata || {
        client_name: clientId,
        vp_formats: VP_FORMATS
      };

    if (
      !clientMetadata ||
      typeof clientMetadata !== "object" ||
      Array.isArray(clientMetadata)
    ) {
      throw new Error(
        "authorizationDetails.clientMetadata must be an object"
      );
    }

    params.set(
      "client_metadata",
      JSON.stringify(clientMetadata)
    );
  }

  return `${DEFAULT_PROTOCOL}authorize?${params.toString()}`;
}

module.exports = {
  createAuthorizationRequestUri
};
