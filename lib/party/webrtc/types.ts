/**
 * Structural subsets of the WebRTC API. Declaring only what we use lets Bun
 * tests inject fakes without a native WebRTC dependency, and keeps the browser
 * API out of module scope so static prerendering never touches it.
 */

export interface DataChannelLike {
  readonly label: string;
  readonly readyState: "connecting" | "open" | "closing" | "closed";
  readonly bufferedAmount: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SessionDescriptionLike {
  readonly type: string;
  readonly sdp?: string;
}

/** The slice of `RTCStatsReport` used to find the selected candidate pair. */
export interface StatsReportLike {
  forEach(callback: (report: unknown) => void): void;
  get?(id: string): unknown;
}

export interface PeerConnectionLike {
  readonly iceGatheringState: "new" | "gathering" | "complete";
  readonly connectionState:
    | "new"
    | "connecting"
    | "connected"
    | "disconnected"
    | "failed"
    | "closed";
  readonly localDescription: SessionDescriptionLike | null;
  readonly remoteDescription: SessionDescriptionLike | null;
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  ondatachannel: ((event: { channel: DataChannelLike }) => void) | null;
  createDataChannel(
    label: string,
    options?: { ordered?: boolean },
  ): DataChannelLike;
  createOffer(): Promise<SessionDescriptionLike>;
  createAnswer(): Promise<SessionDescriptionLike>;
  setLocalDescription(description: SessionDescriptionLike): Promise<void>;
  setRemoteDescription(description: SessionDescriptionLike): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  /** Optional so Bun tests can use structural fakes without WebRTC. */
  getStats?(): Promise<StatsReportLike>;
  close(): void;
}

export interface PeerConnectionConfigLike {
  readonly iceServers: RTCIceServer[];
}

export type PeerConnectionFactory = (
  config: PeerConnectionConfigLike,
) => PeerConnectionLike;

/**
 * Returns the browser factory, or null when WebRTC is unavailable (an insecure
 * origin sends `RTCPeerConnection` away entirely). Resolved lazily on purpose.
 */
export function defaultPeerConnectionFactory(): PeerConnectionFactory | null {
  if (typeof RTCPeerConnection === "undefined") {
    return null;
  }

  return (config) => new RTCPeerConnection(config) as unknown as PeerConnectionLike;
}
