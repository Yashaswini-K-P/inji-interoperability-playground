const DEFAULT_PROTOCOL = "openid4vp://";

/**
 * Validate that a value is a non-empty string.
 */
function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

/**
 * Validate an absolute HTTP(S) URL.
 */
function requireHttpUrl(value, fieldName) {
  requireString(value, fieldName);

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch (error) {
    throw new Error(
      `${fieldName} must be an absolute HTTP(S) URL`
    );
  }

  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error(
      `${fieldName} must be an absolute HTTP(S) URL`
    );
  }

  return value;
}

/**
 * Validate that a URL can be reached by a separate mobile device.
 * Loopback and Docker host addresses cannot be used by a separate device.
 */
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

/**
 * Validate the Digital Credentials Query Language (DCQL) query.
 */
function validateDcqlQuery(dcqlQuery) {
  if (
    !dcqlQuery ||
    typeof dcqlQuery !== "object" ||
    Array.isArray(dcqlQuery)
  ) {
    throw new Error("dcqlQuery must be an object");
  }

  if (
    !Array.isArray(dcqlQuery.credentials) ||
    dcqlQuery.credentials.length === 0
  ) {
    throw new Error(
      "dcqlQuery must contain a non-empty credentials array"
    );
  }

  return dcqlQuery;
}

/**
 * Create an OpenID4VP authorization request URI.
 *
 * Supports:
 * 1. request_uri
 * 2. presentation_definition_uri
 * 3. presentation_definition
 * 4. dcql_query
 */
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
    throw new Error(
      "Verifier response must be an object"
    );
  }

  const params = new URLSearchParams();

  params.set("client_id", clientId);

  /*
   * Option 1: use a request_uri provided by the verifier.
   */
  if (verifierResponse.requestUri !== undefined) {
    if (
      verifierResponse.authorizationDetails !== undefined
    ) {
      throw new Error(
        "Verifier response must include either requestUri or authorizationDetails, not both"
      );
    }

    const requestUri = requireWalletReachableUrl(
      verifierResponse.requestUri,
      "requestUri"
    );

    params.set("request_uri", requestUri);

    return `${DEFAULT_PROTOCOL}authorize?${params.toString()}`;
  }

  /*
   * Option 2: build the authorization request from authorizationDetails.
   */
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

  /*
   * Validate the client ID returned by the verifier.
   */
  const responseClientId = requireString(
    authorizationDetails.clientId,
    "authorizationDetails.clientId"
  );

  if (responseClientId !== clientId) {
    throw new Error(
      "Verifier response clientId does not match INJI_VERIFY_CLIENT_ID"
    );
  }

  /*
   * Validate standard OpenID4VP authorization parameters.
   */
  const requestId = requireString(
    verifierResponse.requestId,
    "requestId"
  );

  const state =
    authorizationDetails.state === undefined
      ? requestId
      : requireString(
          authorizationDetails.state,
          "authorizationDetails.state"
        );

  const responseType = requireString(
    authorizationDetails.responseType,
    "authorizationDetails.responseType"
  );

  const responseMode = requireString(
    authorizationDetails.responseMode,
    "authorizationDetails.responseMode"
  );

  const nonce = requireString(
    authorizationDetails.nonce,
    "authorizationDetails.nonce"
  );

  const responseUri = requireWalletReachableUrl(
    authorizationDetails.responseUri,
    "authorizationDetails.responseUri"
  );

  params.set("state", state);
  params.set("response_type", responseType);
  params.set("response_mode", responseMode);
  params.set("nonce", nonce);
  params.set("response_uri", responseUri);

  /*
   * Read the supported credential-request formats.
   *
   * DCQL can appear in camelCase or snake_case, depending on
   * the response shape produced by the integration.
   */
  const definitionUri =
    authorizationDetails.presentationDefinitionUri;

  const definition =
    authorizationDetails.presentationDefinition;

  const dcqlQuery =
    authorizationDetails.dcqlQuery ??
    authorizationDetails.dcql_query ??
    verifierResponse.dcqlQuery ??
    verifierResponse.dcql_query;

  /*
   * Exactly one credential-request format must be supplied.
   */
  const hasDefinitionUri =
    definitionUri !== undefined;

  const hasDefinition =
    definition !== undefined;

  const hasDcqlQuery =
    dcqlQuery !== undefined;

  const suppliedFormats = [
    hasDefinitionUri,
    hasDefinition,
    hasDcqlQuery,
  ].filter(Boolean).length;

  if (suppliedFormats === 0) {
    throw new Error(
      "Authorization request must include a presentationDefinition, presentationDefinitionUri, or dcqlQuery"
    );
  }

  if (suppliedFormats > 1) {
    throw new Error(
      "Verifier response must include only one credential-request format: presentationDefinition, presentationDefinitionUri, or dcqlQuery"
    );
  }

  /*
   * Option 3: use a presentation definition URI.
   */
  if (hasDefinitionUri) {
    params.set(
      "presentation_definition_uri",
      requireWalletReachableUrl(
        definitionUri,
        "authorizationDetails.presentationDefinitionUri"
      )
    );
  }

  /*
   * Option 4: embed a presentation definition.
   */
  else if (hasDefinition) {
    if (
      !definition ||
      typeof definition !== "object" ||
      Array.isArray(definition)
    ) {
      throw new Error(
        "authorizationDetails.presentationDefinition must be an object"
      );
    }

    params.set(
      "presentation_definition",
      JSON.stringify(definition)
    );
  }

  /*
   * Option 5: embed a DCQL query.
   *
   * OpenID4VP defines dcql_query as a JSON-serialized
   * authorization-request parameter.
   */
  else if (hasDcqlQuery) {
    const validatedDcqlQuery =
      validateDcqlQuery(dcqlQuery);

    params.set(
      "dcql_query",
      JSON.stringify(validatedDcqlQuery)
    );
  }

  /*
   * Add optional client metadata.
   */
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

  const authorizationUri =
    `${DEFAULT_PROTOCOL}authorize?${params.toString()}`;

  return authorizationUri;
}

module.exports = {
  createAuthorizationRequestUri,
};