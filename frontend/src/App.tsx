import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Code2,
  FileCheck2,
  GitBranch,
  History,
  LayoutDashboard,
  LoaderCircle,
  Play,
  QrCode,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ""
).replace(/\/$/, "");

type JsonObject = Record<string, unknown>;

type TestStatus = "PASS" | "FAIL" | "PENDING" | "ERROR" | "UNKNOWN";

type CredentialOption = {
  id: string;
  label: string;
};

async function apiRequest(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const body = asObject(data);
    const diagnostic = asObject(body.diagnostic);

    const message =
      (typeof body.message === "string" && body.message) ||
      (typeof body.error === "string" && body.error) ||
      (typeof body.details === "string" && body.details) ||
      (typeof body.error_description === "string" &&
        body.error_description) ||
      `Request failed with HTTP ${response.status}`;
    const errorCode =
      (typeof body.errorCode === "string" && body.errorCode) ||
      (typeof diagnostic.code === "string" && diagnostic.code) ||
      "";

    throw new Error(errorCode ? `${message} (${errorCode})` : message);
  }

  return data;
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return {};
}

function hideWalletCallbackCapability(value: unknown): unknown {
  const response = asObject(value);
  const wallet = asObject(response.wallet);
  if (!findString(wallet, ["qrPayload"])) return value;

  return {
    ...response,
    wallet: {
      ...wallet,
      qrPayload: "[redacted; capability is carried only inside the QR]",
    },
  };
}

function findString(
  value: unknown,
  keys: string[],
): string | undefined {
  const object = asObject(value);

  for (const key of keys) {
    if (typeof object[key] === "string" && object[key]) {
      return object[key] as string;
    }
  }

  return undefined;
}

function findArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  const object = asObject(value);

  for (const key of [
    "components",
    "items",
    "data",
    "credentials",
    "configurations",
    "scenarios",
    "exchanges",
    "exchangeHistory",
  ]) {
    if (Array.isArray(object[key])) {
      return object[key] as unknown[];
    }
  }

  return [];
}

function getBackendWalletId(walletId: string): string {
  // The UI distinguishes mobile platforms, while the backend registry uses
  // the component IDs "inji-mobile" and "inji-web".
  if (walletId === "inji-web") return "inji-web";
  if (walletId.startsWith("inji-mobile")) return "inji-mobile";
  return walletId;
}

function normalizeStatus(value: unknown): TestStatus {
  if (typeof value !== "string") return "UNKNOWN";

  const status = value.toUpperCase().replace(/[\s-]+/g, "_");

  if (
    ["PASS", "PASSED", "VALID", "SUCCESS", "VERIFIED"].includes(status)
  ) {
    return "PASS";
  }

  if (["FAIL", "FAILED", "INVALID", "REJECTED"].includes(status)) {
    return "FAIL";
  }

  if (["ERROR", "UNAVAILABLE"].includes(status)) return "ERROR";

  if (
    [
      "PENDING",
      "PROCESSING",
      "IN_PROGRESS",
      "WAITING",
      "SUBMITTED",
    ].includes(status)
  ) {
    return "PENDING";
  }

  return "UNKNOWN";
}

function getQrPayload(value: unknown): string | undefined {
  const qrKeys = [
    "credentialOfferUri",
    "credential_offer_uri",
    "offerUri",
    "offer_uri",
    "qrUri",
    "qr_uri",
    "qrPayload",
    "qr_payload",
    "presentationUri",
    "presentation_uri",
    "uri",
  ];

  // First check the current object. The wallet presentation response uses
  // wallet.qrUri, while issuer and verifier responses may use other keys.
  const directMatch = findString(value, qrKeys);
  if (directMatch) return directMatch;

  const object = asObject(value);
  const nestedFields = [
    "wallet",
    "presentationRequest",
    "authorizationRequest",
    "verifierResponse",
    "data",
    "result",
  ];

  for (const field of nestedFields) {
    const nestedValue = object[field];
    if (nestedValue && typeof nestedValue === "object") {
      const nestedMatch = getQrPayload(nestedValue);
      if (nestedMatch) return nestedMatch;
    }
  }

  return undefined;
}

function StatusBadge({ status }: { status: TestStatus }) {
  const icons: Record<TestStatus, ReactNode> = {
    PASS: <CheckCircle2 size={13} />,
    FAIL: <XCircle size={13} />,
    PENDING: <Clock3 size={13} />,
    ERROR: <CircleAlert size={13} />,
    UNKNOWN: <Activity size={13} />,
  };

  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {icons[status]}
      {status}
    </span>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div className="panel-title">
          {icon}
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function JsonViewer({ value }: { value: unknown }) {
  return (
    <pre className="json-viewer">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "connected" | "offline"
  >("checking");

  const [components, setComponents] = useState<unknown>(null);
  const [scenarios, setScenarios] = useState<unknown>(null);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);

  const [issuer, setIssuer] = useState("inji-certify");
  const [wallet, setWallet] = useState("inji-mobile-android");
  const [verifier, setVerifier] = useState("inji-verify");
  const [credentialId, setCredentialId] = useState("");
  const [credentialFormat, setCredentialFormat] =
    useState("ldp_vc");
  const [issuanceFlow, setIssuanceFlow] =
    useState("pre_authorized_code");
  const [txCode, setTxCode] = useState("");

  const [runId, setRunId] = useState("");
  const [runData, setRunData] = useState<unknown>(null);
  const [offerData, setOfferData] = useState<unknown>(null);
  const [issuanceHandoffData, setIssuanceHandoffData] =
    useState<unknown>(null);
  const [verifyData, setVerifyData] = useState<unknown>(null);
  const [presentationData, setPresentationData] = useState<unknown>(null);
  const [resultData, setResultData] = useState<unknown>(null);
  const [selectedPayload, setSelectedPayload] = useState<unknown>(null);

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resultStatus, setResultStatus] = useState<TestStatus>("UNKNOWN");
  const [activeTab, setActiveTab] = useState("Dashboard");

  // Inji Verify 0.18.x accepts Presentation Exchange definitions for VP requests.
  const [presentationDefinitionText, setPresentationDefinitionText] = useState(
    JSON.stringify(
      {
        id: "playground-presentation-definition",
        input_descriptors: [
          {
            id: "requested-credential",
            format: { ldp_vc: {} },
            constraints: { fields: [{ path: ["$.type[*]"] }] },
          },
        ],
      },
      null,
      2,
    ),
  );

  async function refreshRegistry() {
    setError("");
    setNotice("");

    // Check the core backend independently of the issuer service.
    try {
      await apiRequest("/api/health");

      const [componentData, scenarioData] = await Promise.all([
        apiRequest("/api/components"),
        apiRequest("/api/scenarios"),
      ]);

      setBackendStatus("connected");
      setComponents(componentData);
      setScenarios(scenarioData);
    } catch (err) {
      setBackendStatus("offline");
      setError(
        `Unable to load backend data: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
      return;
    }

    // An unavailable issuer should not mark the core backend as offline.
    try {
      const credentialData = await apiRequest(
        "/api/issuers/inji-certify/credentials",
      );

      const credentialItems = findArray(credentialData).map(
        (item, index): CredentialOption => {
          const id =
            findString(item, [
              "id",
              "credentialType",
              "credential_type",
              "configurationId",
              "credentialConfigurationId",
              "type",
            ]) || `credential-${index + 1}`;

          const label =
            findString(item, [
              "displayName",
              "name",
              "credentialType",
              "type",
            ]) || id;

          return { id, label };
        },
      );

      setCredentials(credentialItems);

      if (credentialItems.length > 0) {
        setCredentialId((current) => current || credentialItems[0].id);
      }
    } catch (err) {
      setCredentials([]);
      setNotice(
        `Backend connected, but issuer credentials could not be loaded. ` +
          `The issuer service may be unavailable. ${
            err instanceof Error ? err.message : ""
          }`,
      );
    }
  }

  useEffect(() => {
    void refreshRegistry();
  }, []);

  const refreshRun = useCallback(async (id = runId) => {
    if (!id) return;

    const response = await apiRequest(
      `/api/runs/${encodeURIComponent(id)}`,
    );

    const responseObject = asObject(response);
    const run = responseObject.run ?? response;

    setRunData(run);
    setSelectedPayload(response);
  }, [runId]);

  const runObject = asObject(runData);
  const issuanceStatus =
    findString(runObject, ["issuanceStatus"])?.toUpperCase() || "PENDING";

  useEffect(() => {
    if (
      !runId ||
      issuanceHandoffData === null ||
      issuanceStatus === "STORED"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshRun(runId).catch((err) => {
        setError(
          `Unable to refresh the wallet issuance status: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      });
    }, 4000);

    return () => window.clearInterval(timer);
  }, [runId, issuanceHandoffData, issuanceStatus, refreshRun]);

  async function startRun() {
    if (!credentialId) {
      setError("Select a credential type before creating a test run.");
      return;
    }

    setBusy("run");
    setError("");
    setNotice("");

    setRunId("");
    setRunData(null);
    setOfferData(null);
    setIssuanceHandoffData(null);
    setVerifyData(null);
    setPresentationData(null);
    setResultData(null);
    setSelectedPayload(null);
    setResultStatus("UNKNOWN");

    try {
      // These property names match the existing POST /api/runs route.
      const response = await apiRequest("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          issuer,
          credential: credentialId,
          format: credentialFormat,
          issuanceFlow,
          wallet: getBackendWalletId(wallet),
          verifier,
          presentationProtocol: "openid4vp",
        }),
      });

      setSelectedPayload(response);

      const responseObject = asObject(response);
      const createdRun = asObject(responseObject.run ?? responseObject.data);

      const id =
        findString(createdRun, ["runId", "run_id", "id"]) ||
        findString(responseObject, ["runId", "run_id", "id"]);

      if (!id) {
        setError(
          "The backend did not return a recognizable run ID. " +
            "Select Run response in the Protocol Inspector to inspect it.",
        );
        return;
      }

      setRunId(id);
      setNotice(`Created test run ${id}`);

      try {
        await refreshRun(id);
      } catch (err) {
        setError(
          `The run was created, but its details could not be loaded: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    } catch (err) {
      setError(
        `Run creation failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setBusy("");
    }
  }

  async function generateOffer() {
  if (!runId) {
    setError("Create a test run first.");
    return;
  }

  if (!credentialId) {
    setError("Select a credential type first.");
    return;
  }

  setBusy("offer");
  setError("");
  setNotice("");

  try {
    const data = await apiRequest(
      `/api/issuance/runs/${encodeURIComponent(runId)}/pre-authorized-offer`,
      {
        method: "POST",
        body: JSON.stringify({
          issuerId: issuer,
          credentialConfigurationId: credentialId,
          claims: {},
          expiresIn: 600,
          ...(txCode ? { txCode } : {}),
        }),
      },
    );

    setOfferData(data);
    setSelectedPayload(data);

    setNotice(
      "Credential offer generated. This does not confirm credential delivery.",
    );

    try {
      await refreshRun();
    } catch {
      // Keep the successful offer response visible.
    }
  } catch (err) {
    setError(
      `Offer generation failed: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    );
  } finally {
    setBusy("");
  }
}
  async function prepareIssuanceHandoff() {
    if (!runId) {
      setError("Create a test run first.");
      return;
    }

    setBusy("issuance");
    setError("");
    setNotice("");

    try {
      const data = await apiRequest(
        `/api/wallet/runs/${encodeURIComponent(runId)}/continue`,
      );

      setIssuanceHandoffData(data);
      setSelectedPayload(hideWalletCallbackCapability(data));
      setNotice(
        "Issuance handoff prepared. Credential receipt remains unconfirmed.",
      );

      try {
        await refreshRun();
      } catch {
        // Preserve the handoff response if history is unavailable.
      }
    } catch (err) {
      setError(
        `Issuance handoff failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setBusy("");
    }
  }

  async function prepareVerifyRequest() {
    if (!runId) {
      setError("Create a test run first.");
      return;
    }

    let presentationDefinition: unknown;

    try {
      presentationDefinition = JSON.parse(presentationDefinitionText);
    } catch {
      setError("Presentation definition must contain valid JSON.");
      return;
    }

    const presentationDefinitionObject = asObject(
      presentationDefinition,
    );

    if (
      typeof presentationDefinitionObject.id !== "string" ||
      !Array.isArray(presentationDefinitionObject.input_descriptors) ||
      presentationDefinitionObject.input_descriptors.length === 0
    ) {
      setError(
        'Presentation definition must contain an "id" and a non-empty "input_descriptors" array.',
      );
      return;
    }

    setBusy("verify");
    setError("");
    setNotice("");

    try {
      const data = await apiRequest(
        `/api/verify/runs/${encodeURIComponent(runId)}/request`,
        {
          method: "POST",
          body: JSON.stringify({
            presentationDefinition,
          }),
        },
      );

      setVerifyData(data);
      setSelectedPayload(data);
      setNotice(
        "DID-based Verify request generated. The wallet retrieves the signed request from its request URI; no verification outcome is implied.",
      );

      try {
        await refreshRun();
      } catch {
        // Keep the Verify response visible.
      }
    } catch (err) {
      setError(
        `Verify request failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setBusy("");
    }
  }

  async function preparePresentation() {
    if (!runId) {
      setError("Create a test run first.");
      return;
    }

    setBusy("presentation");
    setError("");
    setNotice("");

    try {
      const data = await apiRequest(
        `/api/wallet/runs/${encodeURIComponent(runId)}/presentation`,
        {
          method: "POST",
          body: JSON.stringify({
            walletId: getBackendWalletId(wallet),
          }),
        },
      );

      setPresentationData(data);
      setSelectedPayload(data);
      setNotice(
        "Presentation handoff prepared. Presentation submission remains unconfirmed.",
      );

      try {
        await refreshRun();
      } catch {
        // Preserve the presentation response if history is unavailable.
      }
    } catch (err) {
      setError(
        `Presentation handoff failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setBusy("");
    }
  }

  async function getResult() {
    if (!runId) {
      setError("Create a test run first.");
      return;
    }

    setBusy("result");
    setError("");
    setNotice("");

    try {
      const data = await apiRequest(
        `/api/verify/runs/${encodeURIComponent(runId)}/result`,
      );

      setResultData(data);
      setSelectedPayload(data);

      const status = findString(data, [
        "verificationStatus",
        "verification_status",
        "status",
        "result",
        "outcome",
      ]);

      setResultStatus(normalizeStatus(status));
      setNotice(
        status
          ? `Backend returned verification status: ${status}`
          : "Response received. Inspect the payload for the authoritative verification outcome.",
      );

      try {
        await refreshRun();
      } catch {
        // The verification response remains available for inspection.
      }
    } catch (err) {
      setResultStatus("ERROR");
      setError(
        `Verification result unavailable: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setBusy("");
    }
  }

  const offerQr =
    issuanceHandoffData !== null
      ? getQrPayload(issuanceHandoffData)
      : undefined;
  const presentationQr = getQrPayload(presentationData);

  const exchanges = findArray(
    runObject.exchanges ?? runObject.exchangeHistory,
  );

  const steps: {
    title: string;
    status: TestStatus;
    description: string;
  }[] = [
    {
      title: "Credential offer generated",
      status: offerData !== null ? "PASS" : "PENDING",
      description: "Generated by the issuance-offer endpoint.",
    },
    {
      title: "Issuance handoff prepared",
      status: issuanceHandoffData !== null ? "PASS" : "PENDING",
      description: "Waiting for the wallet handoff response.",
    },
    {
      title: "Credential received by wallet",
      status: issuanceStatus === "STORED" ? "PASS" : "PENDING",
      description:
        issuanceStatus === "STORED"
          ? "The wallet confirmed the credential is present in its encrypted store."
          : "Waiting for the wallet to finish issuance and confirm encrypted storage.",
    },
    {
      title: "Presentation request generated",
      status: verifyData !== null ? "PASS" : "PENDING",
      description: "Generated by the Verify request endpoint.",
    },
    {
      title: "Presentation handoff prepared",
      status: presentationData !== null ? "PASS" : "PENDING",
      description:
        "Handoff preparation does not confirm presentation submission.",
    },
    {
      title: "Verification result received",
      status: resultData !== null ? resultStatus : "PENDING",
      description:
        "The authoritative verification response determines the result.",
    },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={25} />
          </div>

          <div>
            <strong>INJI</strong>
            <span>INTEROPERABILITY PLAYGROUND</span>
          </div>
        </div>

        <div className="side-label">WORKSPACE</div>

        {[
          { label: "Dashboard", icon: <LayoutDashboard size={18} /> },
          { label: "Create Test", icon: <Play size={18} /> },
          { label: "Interoperability Matrix", icon: <GitBranch size={18} /> },
          { label: "Test History", icon: <History size={18} /> },
          { label: "Tamper Test", icon: <ShieldCheck size={18} /> },
          { label: "Reports", icon: <FileCheck2 size={18} /> },
          { label: "Settings", icon: <Settings2 size={18} /> },
        ].map((item) => (
          <button
            key={item.label}
            className={`nav-item ${
              activeTab === item.label ? "active" : ""
            }`}
            onClick={() => setActiveTab(item.label)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className={`connection-indicator ${backendStatus}`}>
            <span className="connection-dot" />

            <div>
              <strong>
                {backendStatus === "connected"
                  ? "Backend connected"
                  : backendStatus === "checking"
                    ? "Checking backend"
                    : "Backend unavailable"}
              </strong>
              <span>localhost:5000</span>
            </div>

            <button
              className="icon-button"
              title="Refresh backend"
              onClick={() => void refreshRegistry()}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="sidebar-footer">
            MOSIP DECODE 2026
            <span>Problem Statement 02</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              DEVELOPER TOOLS <span>/</span> VERIFIABLE CREDENTIALS
            </div>

            <h1>Interoperability Playground</h1>

            <p>
              Test. Compare. Diagnose. Build a more interoperable digital
              identity ecosystem.
            </p>
          </div>

          <div className="topbar-actions">
            <span className="environment-badge">
              <span className="connection-dot" />
              LOCAL ENVIRONMENT
            </span>

            <button
              className="secondary-button"
              onClick={() => void refreshRegistry()}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </header>

        {error !== "" && (
          <div className="alert alert-error">
            <CircleAlert size={18} />
            <p>{error}</p>
            <button onClick={() => setError("")}>×</button>
          </div>
        )}

        {notice !== "" && (
          <div className="alert alert-info">
            <Activity size={18} />
            <p>{notice}</p>
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-icon purple">
              <Activity size={19} />
            </div>
            <div className="metric-label">Backend status</div>
            <div className="metric-value small-value">
              {backendStatus === "connected"
                ? "Connected"
                : backendStatus === "checking"
                  ? "Checking..."
                  : "Unavailable"}
            </div>
            <div className="metric-caption">Live API connectivity</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon blue">
              <FileCheck2 size={19} />
            </div>
            <div className="metric-label">Discovered credentials</div>
            <div className="metric-value">{credentials.length}</div>
            <div className="metric-caption">From issuer API</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon green">
              <GitBranch size={19} />
            </div>
            <div className="metric-label">Current run</div>
            <div className="metric-value small-value">
              {runId ? "Created" : "Not started"}
            </div>
            <div className="metric-caption">{runId || "No active run"}</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon orange">
              <ShieldCheck size={19} />
            </div>
            <div className="metric-label">Verification</div>
            <div className="metric-value small-value">
              {resultData !== null ? resultStatus : "Pending"}
            </div>
            <div className="metric-caption">Actual Verify response</div>
          </div>
        </div>

        {activeTab === "Dashboard" || activeTab === "Create Test" ? (
          <>
            <Panel
              title="Scenario configuration"
              icon={<Settings2 size={19} />}
            >
              <div className="flow-strip">
                <div className="flow-node">
                  <div className="flow-icon issuer-icon">
                    <FileCheck2 size={22} />
                  </div>
                  <span className="flow-role">ISSUER</span>
                  <strong>Inji Certify</strong>
                  <span className="flow-subtitle">Credential issuance</span>
                </div>

                <ArrowRight className="flow-arrow" size={22} />

                <div className="flow-node">
                  <div className="flow-icon wallet-icon">
                    <Wallet size={22} />
                  </div>
                  <span className="flow-role">WALLET</span>
                  <strong>
                    {wallet === "inji-mobile-android"
                      ? "Inji Mobile · Android"
                      : wallet === "inji-mobile-ios"
                        ? "Inji Mobile · iOS"
                        : "Inji Web"}
                  </strong>
                  <span className="flow-subtitle">Credential holder</span>
                </div>

                <ArrowRight className="flow-arrow" size={22} />

                <div className="flow-node">
                  <div className="flow-icon verify-icon">
                    <ShieldCheck size={22} />
                  </div>
                  <span className="flow-role">VERIFIER</span>
                  <strong>Inji Verify</strong>
                  <span className="flow-subtitle">Credential verification</span>
                </div>
              </div>

              <div className="configuration-grid">
                <label className="form-field">
                  <span>Issuer</span>
                  <select
                    value={issuer}
                    onChange={(event) => setIssuer(event.target.value)}
                  >
                    <option value="inji-certify">Inji Certify</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Credential type</span>
                  <select
                    value={credentialId}
                    onChange={(event) => setCredentialId(event.target.value)}
                  >
                    {credentials.length === 0 && (
                      <option value="">No credentials discovered</option>
                    )}

                    {credentials.map((credential) => (
                      <option key={credential.id} value={credential.id}>
                        {credential.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Credential format</span>
                  <select
                    value={credentialFormat}
                    onChange={(event) =>
                      setCredentialFormat(event.target.value)
                    }
                  >
                    <option value="ldp_vc">W3C VC JSON-LD</option>
                    <option value="sd_jwt_vc">SD-JWT VC</option>
                    <option value="mso_mdoc">mDoc / mDL</option>
                  </select>
                  <small>
                    Confirm format support for the selected credential.
                  </small>
                </label>

                <label className="form-field">
                  <span>Issuance flow</span>
                  <select
                    value={issuanceFlow}
                    onChange={(event) => setIssuanceFlow(event.target.value)}
                  >
                    <option value="pre_authorized_code">
                      Pre-Authorized Code
                    </option>
                    <option value="authorization_code">
                      Authorization Code
                    </option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Wallet</span>
                  <select
                    value={wallet}
                    onChange={(event) => setWallet(event.target.value)}
                  >
                    <option value="inji-mobile-android">
                      Inji Mobile — Android
                    </option>
                    <option value="inji-mobile-ios">
                      Inji Mobile — iOS
                    </option>
                    <option value="inji-web">Inji Web</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Verifier</span>
                  <select
                    value={verifier}
                    onChange={(event) => setVerifier(event.target.value)}
                  >
                    <option value="inji-verify">Inji Verify</option>
                  </select>
                </label>
              </div>

              <div className="scenario-actions">
                <span className="action-note">
                  <span className="connection-dot" />
                  Live backend integration
                </span>

                <button
                  className="primary-button"
                  disabled={
                    busy !== "" ||
                    backendStatus !== "connected" ||
                    !credentialId
                  }
                  onClick={() => void startRun()}
                >
                  {busy === "run" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  Run Test
                </button>
              </div>
            </Panel>

            <div className="content-grid">
              <Panel
                title="Issuer · Credential offer"
                icon={<FileCheck2 size={19} />}
              >
                <p className="panel-description">
                  Generate an issuance offer and prepare a wallet-aware QR.
                  Inji Mobile completes token exchange, proof signing, and
                  credential storage using its native VCI client.
                </p>

                <div className="operation-status">
                  <span>Current run</span>
                  <strong>{runId || "Create a test run first"}</strong>
                </div>
                <div className="operation-status">
                  <span>Wallet credential status</span>
                  <strong>{issuanceStatus}</strong>
                </div>

                <label className="form-field">
                  <span>Certify transaction code (optional)</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={txCode}
                    onChange={(event) => setTxCode(event.target.value)}
                    placeholder="Only if required by the issuer"
                  />
                  <small>
                    If Certify requires a transaction code, enter the same
                    value in Inji Mobile when prompted.
                  </small>
                </label>

                <div className="button-stack">
                  <button
                    className="primary-button full-width"
                    disabled={!runId || busy !== ""}
                    onClick={() => void generateOffer()}
                  >
                    {busy === "offer" ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                    Generate Credential Offer
                  </button>

                  <button
                    className="secondary-button full-width"
                    disabled={!runId || busy !== ""}
                    onClick={() => void prepareIssuanceHandoff()}
                  >
                    Prepare Issuance Handoff
                    <ArrowRight size={16} />
                  </button>
                </div>

                <div className="disclaimer">
                  <CircleAlert size={16} />
                  <p>
                    Configure backend PLAYGROUND_PUBLIC_URL with the phone-
                    reachable HTTPS tunnel origin. Scan the prepared QR using
                    the playground-enabled local Inji Mobile build; the plain
                    Certify offer QR cannot report a correlated outcome.
                  </p>
                </div>

                {offerQr && (
                  <div className="qr-panel">
                    <QRCodeSVG value={offerQr} size={176} />
                    <strong>Inji Mobile issuance handoff QR</strong>
                    <span>
                      Scan in the playground-enabled Inji Mobile app; then
                      approve the issuer and any transaction-code prompt.
                    </span>
                  </div>
                )}

                {offerData !== null && (
                  <details>
                    <summary>View offer response</summary>
                    <JsonViewer value={offerData} />
                  </details>
                )}

              </Panel>

              <Panel
                title="Verify · Presentation"
                icon={<ShieldCheck size={19} />}
              >
                <p className="panel-description">
                  Configure a presentation request and prepare the wallet
                  handoff. Result retrieval waits for Verify's submission
                  status (up to its configured long-poll timeout).
                </p>

                <label className="form-field">
                  <span>Presentation definition (JSON)</span>
                  <textarea
                    className="definition-editor"
                    value={presentationDefinitionText}
                    onChange={(event) =>
                      setPresentationDefinitionText(event.target.value)
                    }
                    spellCheck={false}
                  />
                </label>

                <div className="button-stack">
                  <button
                    className="primary-button full-width"
                    disabled={!runId || busy !== ""}
                    onClick={() => void prepareVerifyRequest()}
                  >
                    {busy === "verify" ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <QrCode size={16} />
                    )}
                    Generate Verify Request
                  </button>

                  <button
                    className="secondary-button full-width"
                    disabled={!runId || busy !== ""}
                    onClick={() => void preparePresentation()}
                  >
                    <QrCode size={16} />
                    Prepare Presentation Handoff
                  </button>

                  <button
                    className="secondary-button full-width"
                    disabled={!runId || busy !== ""}
                    onClick={() => void getResult()}
                  >
                    <RefreshCw size={16} />
                    Retrieve Verification Result
                  </button>
                </div>

                {presentationQr && (
                  <div className="qr-panel">
                    <QRCodeSVG value={presentationQr} size={176} />
                    <strong>Wallet handoff QR</strong>
                    <span>Presentation submission is unconfirmed.</span>
                    <code className="qr-uri">{presentationQr}</code>
                  </div>
                )}

                {resultData !== null && (
                  <div className="result-box">
                    <div className="result-heading">
                      <ShieldCheck size={20} />
                      <strong>Verification result</strong>
                      <StatusBadge status={resultStatus} />
                    </div>
                    <JsonViewer value={resultData} />
                  </div>
                )}
              </Panel>
            </div>

            <Panel
              title="Protocol flow"
              icon={<GitBranch size={19} />}
            >
              <div className="timeline-toolbar">
                <div>
                  <strong>Issuance → Presentation → Verification</strong>
                  <p>
                    Steps reflect frontend actions and backend-recorded
                    exchanges. Unconfirmed operations remain pending.
                  </p>
                </div>

                <button
                  className="secondary-button"
                  disabled={!runId || busy !== ""}
                  onClick={() =>
                    void refreshRun().catch((err: unknown) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Unable to refresh exchanges",
                      ),
                    )
                  }
                >
                  <RefreshCw size={15} />
                  Refresh Exchanges
                </button>
              </div>

              <div className="timeline">
                {steps.map((step, index) => (
                  <div className="timeline-row" key={step.title}>
                    <div className="timeline-index">{index + 1}</div>

                    <div className="timeline-line">
                      <div className="timeline-dot" />
                      {index !== steps.length - 1 && (
                        <div className="timeline-connector" />
                      )}
                    </div>

                    <div className="timeline-content">
                      <strong>{step.title}</strong>
                      <p>{step.description}</p>
                    </div>

                    <StatusBadge status={step.status} />
                  </div>
                ))}
              </div>

              <div className="exchange-history">
                <h3>Backend-recorded exchanges</h3>

                {exchanges.length > 0 ? (
                  exchanges.map((exchange, index) => (
                    <button
                      className="exchange-row"
                      key={index}
                      onClick={() => setSelectedPayload(exchange)}
                    >
                      <span className="exchange-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <span className="exchange-name">
                        <strong>
                          {findString(exchange, [
                            "name",
                            "type",
                            "step",
                            "operation",
                            "endpoint",
                          ]) || `Exchange ${index + 1}`}
                        </strong>

                        <small>
                          {findString(exchange, [
                            "protocol",
                            "method",
                            "endpoint",
                            "url",
                          ]) || "Backend exchange"}
                        </small>
                      </span>

                      <StatusBadge
                        status={normalizeStatus(
                          findString(exchange, [
                            "status",
                            "outcome",
                            "result",
                          ]),
                        )}
                      />
                    </button>
                  ))
                ) : (
                  <p className="empty-copy">
                    No backend exchanges returned for this run yet.
                  </p>
                )}
              </div>
            </Panel>

            <div className="content-grid">
              <Panel
                title="Protocol Inspector"
                icon={<Code2 size={19} />}
              >
                <p className="panel-description">
                  Inspect actual API responses and backend-recorded exchanges.
                </p>

                <div className="button-stack">
                  {[
                    { label: "Run response", data: runData },
                    { label: "Offer response", data: offerData },
                    {
                      label: "Issuance handoff",
                      data: issuanceHandoffData,
                    },
                    { label: "Verify request", data: verifyData },
                    {
                      label: "Presentation handoff",
                      data: presentationData,
                    },
                    { label: "Verification result", data: resultData },
                    {
                      label: "Selected exchange",
                      data: selectedPayload,
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      className="secondary-button full-width"
                      disabled={item.data === null}
                      onClick={() => setSelectedPayload(item.data)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {selectedPayload !== null ? (
                  <JsonViewer value={selectedPayload} />
                ) : (
                  <p className="empty-copy">
                    No response selected yet. Create a run or perform an
                    operation to inspect its response.
                  </p>
                )}
              </Panel>

              <Panel
                title="Interoperability Matrix"
                icon={<GitBranch size={19} />}
              >
                <p className="panel-description">
                  Current scenario configuration and its observed result.
                </p>

                <div className="matrix-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Issuer</th>
                        <th>Wallet</th>
                        <th>Verifier</th>
                        <th>Result</th>
                      </tr>
                    </thead>

                    <tbody>
                      <tr>
                        <td>Inji Certify</td>
                        <td>
                          {wallet === "inji-mobile-android"
                            ? "Inji Mobile Android"
                            : wallet === "inji-mobile-ios"
                              ? "Inji Mobile iOS"
                              : "Inji Web"}
                        </td>
                        <td>Inji Verify</td>
                        <td>
                          <StatusBadge
                            status={
                              resultData !== null
                                ? resultStatus
                                : "PENDING"
                            }
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="empty-copy">
                  This is the current run, not an aggregate interoperability
                  report. Historical results are not fabricated.
                </p>

                <details>
                  <summary>Discovered components</summary>
                  <JsonViewer value={components} />
                </details>

                <details>
                  <summary>Available scenarios</summary>
                  <JsonViewer value={scenarios} />
                </details>
              </Panel>
            </div>
          </>
        ) : (
          <Panel
            title={activeTab}
            icon={<Activity size={19} />}
          >
            <p className="panel-description">
              This section is not implemented yet. The baseline dashboard,
              API integration, protocol inspector, and current-run matrix
              are available under Dashboard.
            </p>

            <button
              className="primary-button"
              onClick={() => setActiveTab("Dashboard")}
            >
              <LayoutDashboard size={16} />
              Return to Dashboard
            </button>
          </Panel>
        )}

        <footer className="page-footer">
          <div>
            <ShieldCheck size={16} />
            <span>Inji Interoperability Playground</span>
          </div>

          <span>MOSIP DECODE 2026 · Problem Statement 02</span>
        </footer>
      </main>
    </div>
  );
}
