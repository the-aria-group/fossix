export type CompressionKind = 'none' | 'lz4';
export type DataStoreState = 'NotReady' | 'NoInternet' | 'NoAccess' | 'Access';
export type LastSaveReason = 'Manual' | 'External' | 'Shutdown';

export interface SessionTag {
  placeId: number;
  jobId: string;
  sessionId: string;
}

export interface FossixMetaData {
  activeSession?: SessionTag;
  forceLoadSession?: SessionTag;
  lastUpdated: number;
  firstSessionTime?: number;
  sessionLoadCount: number;
  robloxMetaData?: defined;
  userIds: number[];
  compression: CompressionKind;
}

export interface StoredProfileDocument {
  version: number;
  metaData: FossixMetaData;
  data: unknown;
  messageQueue: defined[];
}

export interface CompressionAdapter {
  readonly id: CompressionKind;
  compress(payload: string): buffer;
  decompress(payload: buffer): string;
}

export interface FossixConfig {
  readonly autoSavePeriodSeconds: number;
  readonly loadRepeatPeriodSeconds: number;
  readonly firstLoadRepeatSeconds: number;
  readonly sessionStealSeconds: number;
  readonly assumeDeadSeconds: number;
  readonly startSessionTimeoutSeconds: number;
  readonly maxMessageQueue: number;
  readonly maxSerializedBytes: number;
  readonly compression: CompressionKind;
  readonly compressionAdapter?: CompressionAdapter;
}

export interface StartSessionParams {
  readonly steal?: boolean;
  readonly cancel?: () => boolean;
}

export interface SessionAttemptResult {
  readonly acquired: boolean;
  readonly document?: StoredProfileDocument;
  readonly conflictSession?: SessionTag;
  readonly didSteal: boolean;
}

export interface IDataStoreAdapter {
  updateAsync(
    key: string,
    transform: (current?: StoredProfileDocument) => StoredProfileDocument | undefined,
  ): Promise<StoredProfileDocument | undefined>;
  getAsync(key: string): Promise<StoredProfileDocument | undefined>;
  setAsync(key: string, value: StoredProfileDocument): Promise<void>;
  removeAsync(key: string): Promise<void>;
}

export interface IMessageBusAdapter {
  publish(profileKey: string, payload: unknown): Promise<void>;
  subscribe(
    profileKey: string,
    handler: (payload: unknown) => void,
  ): Promise<RBXScriptConnection | undefined>;
}
