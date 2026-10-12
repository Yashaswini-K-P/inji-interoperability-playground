import { useEffect, useState } from "react";
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
    const message =
      typeof body.message === "string"
        ? body.message
        : `Request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return {};
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
    ["PENDING", "PROCESSING", "IN_PROGRESS", "WAITING"].includes(status)
  ) {
    return "PENDING";
  }

  return "UNKNOWN";
}

function getQrPayload(value: unknown): string | undefined {
  return findString(value, [
    "credentialOfferUri",
    "credential_offer_uri",
    "offerUri",
    "offer_uri",
    "qrPayload",
    "qr_payload",
    "presentationUri",
    "presentation_uri",
    "requestUri",
    "request_uri",
    "uri",
  ]);
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
    useState("W3C VC JSON-LD");
  const [issuanceFlow, setIssuanceFlow] =
    useState("PRE_AUTHORIZED_CODE");

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

  const [presentationDefinition, setPresentationDefinition] = useState(
    JSON.stringify(
      {
        id: "credential-verification",
        input_descriptors: [
          {
            id: "requested-credential",
            constraints: {
              fields: [{ path: ["$.type"] }],
            },
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

  // First, check the core backend endpoints.
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

  // Load issuer credentials separately.
  // If the issuer is unavailable, keep the dashboard running.
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
      setCredentialId(
        (current) => current || credentialItems[0].id,
      );
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

  async function refreshRun(id = runId) {
    if (!id) return;

    const data = await apiRequest(
      `/api/runs/${encodeURIComponent(id)}`,
    );

    setRunData(data);
    setSelectedPayload(data);
  }

  async function startRun() {
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
      /*
       * Confirm these request field names against your friend's
       * POST /api/runs implementation before relying on them.
       */
      const response = await apiRequest("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          issuerId: issuer,
          walletId: wallet,
          verifierId: verifier,
          credentialType: credentialId,
          credentialFormat,
          issuanceFlow,
          presentationProtocol: "OPENID4VP",
        }),
      });

      setSelectedPayload(response);

      const responseObject = asObject(response);
      const responseData = asObject(responseObject.data);

      const id =
        findString(response, ["runId", "run_id", "id"]) ||
        findString(responseData, ["runId", "run_id", "id"]);

      if (!id) {
        setError(
          "The backend response did not contain a recognizable run ID. Inspect the Run response in the Protocol Inspector.",
        );
        return;
      }

      setRunId(id);
      setNotice(`Created test run ${id}`);

      try {
        await refreshRun(id);
      } catch (err) {
        setError(
          `The run was created, but its exchange history could not be loaded: ${
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

    setBusy("offer");
    setError("");

    try {
      const data = await apiRequest(
        `/api/issuance/runs/${encodeURIComponent(runId)}/pre-authorized-offer`,
        { method: "POST" },
      );

      setOfferData(data);
      setSelectedPayload(data);
      setNotice(
        "Credential offer generated. This does not confirm credential delivery.",
      );

      try {
        await refreshRun();
      } catch {
        // Keep the successful offer response visible if history is unavailable.
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

    try {
      const data = await apiRequest(
        `/api/wallet/runs/${encodeURIComponent(runId)}/continue`,
      );

      setIssuanceHandoffData(data);
      setSelectedPayload(data);
      setNotice(
        "Issuance handoff prepared. Credential receipt remains unconfirmed.",
      );

      try {
        await refreshRun();
      } catch {
        // Preserve the handoff response if exchange history is unavailable.
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

    let definition: unknown;

    try {
      definition = JSON.parse(presentationDefinition);
    } catch {
      setError("Presentation definition must contain valid JSON.");
      return;
    }

    setBusy("verify");
    setError("");

    try {
      const data = await apiRequest(
        `/api/verify/runs/${encodeURIComponent(runId)}/request`,
        {
          method: "POST",
          body: JSON.stringify({
            presentationDefinition: definition,
          }),
        },
      );

      setVerifyData(data);
      setSelectedPayload(data);
      setNotice(
        "Presentation request generated. No verification outcome is implied.",
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

    try {
      const data = await apiRequest(
        `/api/wallet/runs/${encodeURIComponent(runId)}/presentation`,
        {
          method: "POST",
          body: JSON.stringify({ walletId: wallet }),
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

  const offerQr = getQrPayload(offerData);
  const requestQr = getQrPayload(verifyData);
  const presentationQr = getQrPayload(presentationData);

  const runObject = asObject(runData);

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
      status: "PENDING",
      description:
        "Requires evidence from the actual wallet or backend.",
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
                    <option value="W3C VC JSON-LD">W3C VC JSON-LD</option>
                    <option value="SD-JWT VC">SD-JWT VC</option>
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
                    <option value="PRE_AUTHORIZED_CODE">
                      Pre-Authorized Code
                    </option>
                    <option value="AUTHORIZATION_CODE">
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
                  disabled={busy !== "" || backendStatus !== "connected"}
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
                  Generate an issuance offer and prepare the wallet handoff.
                </p>

                <div className="operation-status">
                  <span>Current run</span>
                  <strong>{runId || "Create a test run first"}</strong>
                </div>

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
                    An offer is not proof that a credential has been received
                    by the wallet.
                  </p>
                </div>

                {offerQr && (
                  <div className="qr-panel">
                    <QRCodeSVG value={offerQr} size={176} />
                    <strong>Credential offer QR</strong>
                    <span>Scan using a compatible wallet</span>
                    <code className="qr-uri">{offerQr}</code>
                  </div>
                )}

                {offerData !== null && (
                  <details>
                    <summary>View offer response</summary>
                    <JsonViewer value={offerData} />
                  </details>
                )}

                {issuanceHandoffData !== null && (
                  <details>
                    <summary>View issuance handoff response</summary>
                    <JsonViewer value={issuanceHandoffData} />
                  </details>
                )}
              </Panel>

              <Panel
                title="Verify · Presentation"
                icon={<ShieldCheck size={19} />}
              >
                <p className="panel-description">
                  Configure a presentation request and prepare the wallet
                  handoff.
                </p>

                <label className="form-field">
                  <span>Presentation definition (JSON)</span>
                  <textarea
                    className="definition-editor"
                    value={presentationDefinition}
                    onChange={(event) =>
                      setPresentationDefinition(event.target.value)
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

                {requestQr && (
                  <div className="qr-panel">
                    <QRCodeSVG value={requestQr} size={176} />
                    <strong>Presentation request QR</strong>
                    <span>Ready for wallet handoff</span>
                    <code className="qr-uri">{requestQr}</code>
                  </div>
                )}

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