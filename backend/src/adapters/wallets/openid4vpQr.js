const DEFAULT_PROTOCOL = "openid4vp://";

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

function requireWalletReachableUrl(value, fieldName) {
  requireHttpUrl(value, fieldName);

  const hostname = new URL(value).hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const isLoopbackAddress =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);

  if (
    isLoopbackAddress ||
    hostname === "host.docker.internal"
  ) {
    throw new Error(
      `${fieldName} must use an address reachable by the mobile wallet; loopback and Docker host addresses are not reachable from a separate device`
    );
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

  const params = new URLSearchParams();

  params.set("client_id", clientId);

  if (verifierResponse.requestUri !== undefined) {
    if (verifierResponse.authorizationDetails !== undefined) {
      throw new Error(
        "Verifier response must include either requestUri or authorizationDetails, not both"
      );
    }

    const requestUri = requireWalletReachableUrl(
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

    const requestId = requireString(
      verifierResponse.requestId,
      "requestId"
    );

    params.set(
      "state",
      authorizationDetails.state === undefined
        ? requestId
        : requireString(
          authorizationDetails.state,
          "authorizationDetails.state"
        )
    );
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
      requireWalletReachableUrl(
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
        requireWalletReachableUrl(
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
      authorizationDetails.clientMetadata;

    if (clientMetadata !== undefined) {
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
  }

  return `${DEFAULT_PROTOCOL}authorize?${params.toString()}`;
}

module.exports = {
  createAuthorizationRequestUri
};
