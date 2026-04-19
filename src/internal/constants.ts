import { FossixConfig } from '../types';

export const DEFAULT_FOSSIX_CONFIG: FossixConfig = {
	autoSavePeriodSeconds: 300,
	loadRepeatPeriodSeconds: 10,
	firstLoadRepeatSeconds: 5,
	sessionStealSeconds: 40,
	assumeDeadSeconds: 630,
	startSessionTimeoutSeconds: 120,
	maxMessageQueue: 1000,
	maxSerializedBytes: 4_000_000,
	compression: 'none',
	compressionAdapter: undefined,
};

export const FOSSIX_SCHEMA_VERSION = 1;
