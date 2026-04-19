import Signal = require('@rbxts/signal');
import { DataStoreService } from '@rbxts/services';
import { Profile } from './Profile';
import { MockDataStoreAdapter, MockMessageBusAdapter, RobloxDataStoreAdapter, RobloxMessageBusAdapter, sameSession } from './internal/adapters';
import { encodePayload, decodePayload } from './internal/compression';
import { DEFAULT_FOSSIX_CONFIG, FOSSIX_SCHEMA_VERSION } from './internal/constants';
import { deepCopy, nowSeconds, randomSessionId } from './internal/deep';
import { KeyQueue } from './internal/keyQueue';
import {
	DataStoreState,
	FossixConfig,
	IDataStoreAdapter,
	IMessageBusAdapter,
	LastSaveReason,
	SessionTag,
	StartSessionParams,
	StoredProfileDocument,
} from './types';

export interface FossixStoreOptions {
	readonly config?: Partial<FossixConfig>;
	readonly dataStoreAdapter?: IDataStoreAdapter;
	readonly messageBusAdapter?: IMessageBusAdapter;
	readonly useMock?: boolean;
}

class VersionQuery<T extends object> {
	private consumed = false;

	public constructor(private readonly store: FossixStore<T>, private readonly key: string) {}

	public async NextAsync(): Promise<Profile<T> | undefined> {
		if (this.consumed) return undefined;
		this.consumed = true;
		return this.store.GetAsync(this.key);
	}
}

export class FossixStore<T extends object> {
	private static readonly instances = new Set<FossixStore<object>>();
	private static closeBound = false;

	public readonly OnError = new Signal<(message: string, storeName: string, profileKey?: string) => void>();
	public readonly OnOverwrite = new Signal<(storeName: string, profileKey: string) => void>();
	public readonly OnCriticalToggle = new Signal<(isCritical: boolean) => void>();

	public IsCriticalState = false;
	public DataStoreState: DataStoreState = 'NotReady';
	public IsClosing = false;

	private readonly config: FossixConfig;
	private readonly dataStoreAdapter: IDataStoreAdapter;
	private readonly messageBusAdapter: IMessageBusAdapter;
	private readonly template?: T;
	private readonly keyQueue = new KeyQueue();
	private readonly activeProfiles = new Map<string, Profile<T>>();
	private readonly saveSubscription = new Map<string, RBXScriptConnection>();
	private readonly errorTimestamps: number[] = [];
	private readonly storeSessionId = randomSessionId();
	private destroyed = false;

	public readonly Name: string;
	public readonly Mock?: FossixStore<T>;

	public static createStore<T extends object>(
		storeName: string,
		template?: T,
		options?: FossixStoreOptions,
	): FossixStore<T> {
		return new FossixStore<T>(storeName, template, options);
	}

	private constructor(storeName: string, template?: T, options?: FossixStoreOptions) {
		this.Name = storeName;
		this.template = template ? deepCopy(template) : undefined;
		this.config = this.mergeConfig(options?.config);

		if (options?.dataStoreAdapter) {
			this.dataStoreAdapter = options.dataStoreAdapter;
		} else if (options?.useMock) {
			this.dataStoreAdapter = new MockDataStoreAdapter();
		} else {
			const globalStore = DataStoreService.GetDataStore(storeName);
			this.dataStoreAdapter = new RobloxDataStoreAdapter(
				globalStore as unknown as {
					UpdateAsync: (key: string, transform: (value: unknown) => unknown) => unknown;
					GetAsync: (key: string) => unknown;
					SetAsync: (key: string, value: unknown) => unknown;
					RemoveAsync: (key: string) => unknown;
				},
			);
		}

		if (options?.messageBusAdapter) {
			this.messageBusAdapter = options.messageBusAdapter;
		} else if (options?.useMock) {
			this.messageBusAdapter = new MockMessageBusAdapter();
		} else {
			this.messageBusAdapter = new RobloxMessageBusAdapter();
		}

		if (!options?.useMock) {
			this.Mock = new FossixStore<T>(`${storeName}:Mock`, template, {
				...options,
				useMock: true,
				dataStoreAdapter: new MockDataStoreAdapter(),
				messageBusAdapter: new MockMessageBusAdapter(),
			});
		}

		this.DataStoreState = 'Access';
		this.startAutoSaveLoop();
		this.registerCloseBinding();
		FossixStore.instances.add(this as unknown as FossixStore<object>);
	}

	public getTemplate(): T | undefined {
		return this.template ? deepCopy(this.template) : undefined;
	}

	public isProfileActive(key: string): boolean {
		return this.activeProfiles.has(key);
	}

	public async StartSessionAsync(
		profileKey: string,
		params: StartSessionParams = {},
	): Promise<Profile<T> | undefined> {
		if (this.IsClosing) return undefined;
		const cached = this.activeProfiles.get(profileKey);
		if (cached) return cached;

		const startedAt = nowSeconds();
		let firstTry = true;
		let elapsed = 0;

		while (elapsed <= this.config.startSessionTimeoutSeconds) {
			if (params.cancel?.()) return undefined;

			const forceSteal = params.steal || elapsed >= this.config.sessionStealSeconds;
			const attempt = await this.tryAcquireSession(profileKey, forceSteal);
			if (attempt) {
				return attempt;
			}

			const delay = firstTry ? this.config.firstLoadRepeatSeconds : this.config.loadRepeatPeriodSeconds;
			firstTry = false;
			task.wait(delay);
			elapsed = nowSeconds() - startedAt;
		}

		this.registerError('StartSessionAsync timed out.', profileKey);
		return undefined;
	}

	public async MessageAsync(profileKey: string, message: unknown): Promise<boolean> {
		try {
			await this.messageBusAdapter.publish(profileKey, message);
			await this.keyQueue.enqueue(profileKey, async () => {
				await this.dataStoreAdapter.updateAsync(profileKey, (current) => {
					const doc = this.ensureDocument(current);
					doc.messageQueue.push(message as defined);
					while (doc.messageQueue.size() > this.config.maxMessageQueue) {
						doc.messageQueue.shift();
					}
					doc.metaData.lastUpdated = nowSeconds();
					return doc;
				});
				return undefined;
			});
			this.registerSuccess();
			return true;
		} catch (err) {
			this.registerError(`MessageAsync failed: ${tostring(err)}`, profileKey);
			return false;
		}
	}

	public async GetAsync(profileKey: string): Promise<Profile<T> | undefined> {
		try {
			const document = await this.dataStoreAdapter.getAsync(profileKey);
			this.registerSuccess();
			if (!document) return undefined;

			const normalized = this.ensureDocument(document);
			const data = this.decodeLiveData(normalized);
			const profile = new Profile<T>(
				this,
				profileKey,
				data,
				normalized.metaData.sessionLoadCount,
				normalized.metaData.firstSessionTime ?? nowSeconds(),
				normalized.metaData.userIds,
				normalized.metaData.robloxMetaData,
			);
			return profile;
		} catch (err) {
			this.registerError(`GetAsync failed: ${tostring(err)}`, profileKey);
			return undefined;
		}
	}

	public VersionQuery(profileKey: string): VersionQuery<T> {
		return new VersionQuery<T>(this, profileKey);
	}

	public async RemoveAsync(profileKey: string): Promise<boolean> {
		try {
			await this.dataStoreAdapter.removeAsync(profileKey);
			this.registerSuccess();
			return true;
		} catch (err) {
			this.registerError(`RemoveAsync failed: ${tostring(err)}`, profileKey);
			return false;
		}
	}

	public async saveProfileInternal(
		profile: Profile<T>,
		isEndingSession: boolean,
		lastSaveReason: LastSaveReason,
	): Promise<boolean> {
		if (!profile.IsActive() && !isEndingSession) return false;

		profile.OnSave.Fire();
		if (isEndingSession) {
			profile.OnLastSave.Fire(lastSaveReason);
		}

		const key = profile.Key;
		try {
			const result = await this.keyQueue.enqueue(key, async () => {
				return this.dataStoreAdapter.updateAsync(key, (current) => {
					const now = nowSeconds();
					const doc = this.ensureDocument(current);
					const mySession = this.makeSessionTag();

					const owner = doc.metaData.activeSession;
					const ownsSession = sameSession(owner, mySession) || owner === undefined;
					if (!ownsSession && !isEndingSession) {
						return doc;
					}

					const payload = encodePayload(
						profile.Data,
						this.config.compression,
						this.config.compressionAdapter,
					);
					if (payload.serializedBytes > this.config.maxSerializedBytes) {
						this.registerError(
							`Profile payload exceeds limit (${payload.serializedBytes} bytes).`,
							key,
						);
						return doc;
					}

					doc.version = FOSSIX_SCHEMA_VERSION;
					doc.data = payload.data;
					doc.metaData.compression = payload.kind;
					doc.metaData.lastUpdated = now;
					doc.metaData.userIds = [...profile.UserIds];
					doc.metaData.robloxMetaData = profile.RobloxMetaData;

					if (isEndingSession) {
						doc.metaData.activeSession = undefined;
						doc.metaData.forceLoadSession = undefined;
					} else {
						doc.metaData.activeSession = mySession;
					}

					return doc;
				});
			});

			if (!result) return false;

			profile.setLastSavedData(deepCopy(profile.Data));
			profile.OnAfterSave.Fire(profile.LastSavedData);
			this.registerSuccess();

			if (isEndingSession) {
				this.deactivateProfile(profile.Key);
				profile.OnSessionEnd.Fire();
			}

			return true;
		} catch (err) {
			this.registerError(`Save failed: ${tostring(err)}`, key);
			return false;
		}
	}

	public async setProfileInternal(profile: Profile<T>): Promise<boolean> {
		try {
			const payload = encodePayload(profile.Data, this.config.compression, this.config.compressionAdapter);
			const now = nowSeconds();
			const previous = await this.dataStoreAdapter.getAsync(profile.Key);
			const doc = this.ensureDocument(previous);
			doc.data = payload.data;
			doc.version = FOSSIX_SCHEMA_VERSION;
			doc.metaData.compression = payload.kind;
			doc.metaData.lastUpdated = now;
			doc.metaData.robloxMetaData = profile.RobloxMetaData;
			doc.metaData.userIds = [...profile.UserIds];
			await this.dataStoreAdapter.setAsync(profile.Key, doc);
			profile.setLastSavedData(deepCopy(profile.Data));
			this.registerSuccess();
			return true;
		} catch (err) {
			this.registerError(`SetAsync failed: ${tostring(err)}`, profile.Key);
			return false;
		}
	}

	public async endSessionInternal(profile: Profile<T>, reason: LastSaveReason): Promise<void> {
		await this.saveProfileInternal(profile, true, reason);
	}

	public async destroy(): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;
		this.IsClosing = true;
		await this.flushAllProfiles('Shutdown');
		for (const [, connection] of this.saveSubscription) {
			connection.Disconnect();
		}
		this.saveSubscription.clear();
		FossixStore.instances.delete(this as unknown as FossixStore<object>);
	}

	private async tryAcquireSession(profileKey: string, allowSteal: boolean): Promise<Profile<T> | undefined> {
		try {
			const sessionTag = this.makeSessionTag();
			let acquired = false;
			let nextSessionLoadCount = 0;
			let firstSessionTime = nowSeconds();
			let userIds: number[] = [];
			let robloxMetaData: defined | undefined;
			let liveData: T | undefined;

			await this.keyQueue.enqueue(profileKey, async () => {
				const updated = await this.dataStoreAdapter.updateAsync(profileKey, (current) => {
					const now = nowSeconds();
					const doc = this.ensureDocument(current);
					const owner = doc.metaData.activeSession;
					const stale = owner !== undefined && now - doc.metaData.lastUpdated >= this.config.assumeDeadSeconds;

					if (!owner || sameSession(owner, sessionTag) || stale || allowSteal) {
						acquired = true;
						doc.version = FOSSIX_SCHEMA_VERSION;
						doc.metaData.activeSession = sessionTag;
						doc.metaData.forceLoadSession = undefined;
						doc.metaData.lastUpdated = now;
						doc.metaData.sessionLoadCount += 1;
						doc.metaData.firstSessionTime = doc.metaData.firstSessionTime ?? now;
						nextSessionLoadCount = doc.metaData.sessionLoadCount;
						firstSessionTime = doc.metaData.firstSessionTime;
						userIds = doc.metaData.userIds;
						robloxMetaData = doc.metaData.robloxMetaData;
						liveData = this.decodeLiveData(doc);
						return doc;
					}

					doc.metaData.forceLoadSession = sessionTag;
					doc.metaData.lastUpdated = now;
					return doc;
				});

				if (updated === undefined) {
					this.registerError('Unexpected undefined document during acquisition.', profileKey);
				}

				return undefined;
			});

			if (!acquired || !liveData) {
				return undefined;
			}

			const profile = new Profile<T>(
				this,
				profileKey,
				liveData,
				nextSessionLoadCount,
				firstSessionTime,
				userIds,
				robloxMetaData,
			);

			const subscription = await this.messageBusAdapter.subscribe(profileKey, (payload) => {
				profile.dispatchMessage(payload);
			});
			if (subscription) {
				this.saveSubscription.set(profileKey, subscription);
			}

			this.activeProfiles.set(profileKey, profile);
			this.registerSuccess();
			await this.flushMessageQueue(profileKey, profile);
			return profile;
		} catch (err) {
			this.registerError(`Session acquisition failed: ${tostring(err)}`, profileKey);
			return undefined;
		}
	}

	private async flushMessageQueue(profileKey: string, profile: Profile<T>): Promise<void> {
		await this.keyQueue.enqueue(profileKey, async () => {
			await this.dataStoreAdapter.updateAsync(profileKey, (current) => {
				const doc = this.ensureDocument(current);
				const queued = [...doc.messageQueue];
					doc.messageQueue = [];
				for (const message of queued) {
					profile.dispatchMessage(message);
				}
				return doc;
			});
			return undefined;
		});
	}

	private decodeLiveData(document: StoredProfileDocument): T {
		const raw = decodePayload(
			document.data,
			document.metaData.compression,
			this.config.compressionAdapter,
		) as T;
		const data = deepCopy(raw);
		if (this.template) {
			profileReconcile(data, this.template);
		}
		return data;
	}

	private ensureDocument(document?: StoredProfileDocument): StoredProfileDocument {
		if (!document) {
			const now = nowSeconds();
			return {
				version: FOSSIX_SCHEMA_VERSION,
				metaData: {
					lastUpdated: now,
					firstSessionTime: undefined,
					sessionLoadCount: 0,
					userIds: [],
					compression: this.config.compression,
				},
				data: this.template ? deepCopy(this.template) : ({} as T),
				messageQueue: [],
			};
		}

		if (!document.metaData || !typeIs(document.metaData, 'table')) {
			this.OnOverwrite.Fire(this.Name, 'unknown');
			const fresh = this.ensureDocument(undefined);
			fresh.data = document.data;
			return fresh;
		}

		document.metaData.sessionLoadCount = document.metaData.sessionLoadCount ?? 0;
		document.metaData.lastUpdated = document.metaData.lastUpdated ?? nowSeconds();
		document.metaData.userIds = document.metaData.userIds ?? [];
		document.metaData.compression = document.metaData.compression ?? this.config.compression;
		document.messageQueue = document.messageQueue ?? [];
		document.version = document.version ?? FOSSIX_SCHEMA_VERSION;
		return document;
	}

	private makeSessionTag(): SessionTag {
		return {
			placeId: game.PlaceId,
			jobId: game.JobId,
			sessionId: this.storeSessionId,
		};
	}

	private mergeConfig(config?: Partial<FossixConfig>): FossixConfig {
		return {
			...DEFAULT_FOSSIX_CONFIG,
			...config,
		};
	}

	private deactivateProfile(profileKey: string): void {
		this.activeProfiles.delete(profileKey);
		const connection = this.saveSubscription.get(profileKey);
		if (connection) {
			connection.Disconnect();
			this.saveSubscription.delete(profileKey);
		}
	}

	private startAutoSaveLoop(): void {
		task.spawn(() => {
			while (!this.destroyed) {
				task.wait(this.config.autoSavePeriodSeconds);
				if (this.destroyed || this.IsClosing) continue;
				for (const [, profile] of this.activeProfiles) {
					task.spawn(() => this.saveProfileInternal(profile, false, 'Manual'));
				}
			}
		});
	}

	private registerCloseBinding(): void {
		if (FossixStore.closeBound) return;
		FossixStore.closeBound = true;
		game.BindToClose(() => {
			const closePromises = new Array<Promise<void>>();
			for (const store of FossixStore.instances) {
				store.IsClosing = true;
				closePromises.push(store.flushAllProfiles('Shutdown'));
			}
			Promise.all(closePromises).catch(() => undefined);
		});
	}

	private async flushAllProfiles(reason: LastSaveReason): Promise<void> {
		const tasks = new Array<Promise<boolean>>();
		for (const [, profile] of this.activeProfiles) {
			tasks.push(this.saveProfileInternal(profile, true, reason));
		}
		await Promise.all(tasks);
	}

	private registerSuccess(): void {
		this.DataStoreState = 'Access';
	}

	private registerError(message: string, profileKey?: string): void {
		const now = nowSeconds();
		this.errorTimestamps.push(now);
		const filtered = this.errorTimestamps.filter((timestamp) => now - timestamp <= 120);
		this.errorTimestamps.clear();
		filtered.forEach((entry) => this.errorTimestamps.push(entry));

		if (!this.IsCriticalState && this.errorTimestamps.size() >= 5) {
			this.IsCriticalState = true;
			this.OnCriticalToggle.Fire(true);
		}

		this.DataStoreState = 'NoAccess';
		this.OnError.Fire(message, this.Name, profileKey);
	}
}

function profileReconcile<T extends object>(target: T, template: T): void {
	for (const [key, value] of pairs(template as never)) {
		const targetTable = target as unknown as Record<string | number, unknown>;
		const current = targetTable[key as string | number];
		if (current === undefined) {
			targetTable[key as string | number] = deepCopy(value as never);
		} else if (typeIs(current, 'table') && typeIs(value, 'table')) {
			profileReconcile(current as never, value as never);
		}
	}
}
