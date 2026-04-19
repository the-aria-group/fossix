import { MessagingService } from '@rbxts/services';
import {
	IDataStoreAdapter,
	IMessageBusAdapter,
	SessionTag,
	StoredProfileDocument,
} from '../types';

const DATASTORE_TOPIC_PREFIX = 'FossixProfile_';
type RobloxStoreLike = {
	UpdateAsync: (key: string, transform: (value: unknown) => unknown) => unknown;
	GetAsync: (key: string) => unknown;
	SetAsync: (key: string, value: unknown) => unknown;
	RemoveAsync: (key: string) => unknown;
};

function topicName(profileKey: string): string {
	return `${DATASTORE_TOPIC_PREFIX}${profileKey}`;
}

export class RobloxDataStoreAdapter implements IDataStoreAdapter {
	public constructor(private readonly store: RobloxStoreLike) {}

	public async updateAsync(
		key: string,
		transform: (current?: StoredProfileDocument) => StoredProfileDocument | undefined,
	): Promise<StoredProfileDocument | undefined> {
		return new Promise((resolve, reject) => {
			const [ok, result] = pcall(() =>
				this.store.UpdateAsync(key, (current: unknown) => transform(current as StoredProfileDocument)),
			);
			if (!ok) {
				reject(result);
				return;
			}
			resolve(result as StoredProfileDocument | undefined);
		});
	}

	public async getAsync(key: string): Promise<StoredProfileDocument | undefined> {
		return new Promise((resolve, reject) => {
			const [ok, result] = pcall(() => this.store.GetAsync(key));
			if (!ok) {
				reject(result);
				return;
			}
			resolve(result as StoredProfileDocument | undefined);
		});
	}

	public async setAsync(key: string, value: StoredProfileDocument): Promise<void> {
		return new Promise((resolve, reject) => {
			const [ok, result] = pcall(() => this.store.SetAsync(key, value));
			if (!ok) {
				reject(result);
				return;
			}
			resolve(result as void);
		});
	}

	public async removeAsync(key: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const [ok, result] = pcall(() => this.store.RemoveAsync(key));
			if (!ok) {
				reject(result);
				return;
			}
			resolve(result as void);
		});
	}
}

export class RobloxMessageBusAdapter implements IMessageBusAdapter {
	public async publish(profileKey: string, payload: unknown): Promise<void> {
		return new Promise((resolve, reject) => {
			const [ok, result] = pcall(() => MessagingService.PublishAsync(topicName(profileKey), payload));
			if (!ok) {
				reject(result);
				return;
			}
			resolve(result as void);
		});
	}

	public async subscribe(
		profileKey: string,
		handler: (payload: unknown) => void,
	): Promise<RBXScriptConnection | undefined> {
		return new Promise((resolve, reject) => {
			const [ok, result] = pcall(() =>
				MessagingService.SubscribeAsync(topicName(profileKey), (message) => {
					handler(message.Data);
				}),
			);
			if (!ok) {
				reject(result);
				return;
			}
			resolve(result as RBXScriptConnection);
		});
	}
}

export class MockDataStoreAdapter implements IDataStoreAdapter {
	private readonly state = new Map<string, StoredProfileDocument>();

	public async updateAsync(
		key: string,
		transform: (current?: StoredProfileDocument) => StoredProfileDocument | undefined,
	): Promise<StoredProfileDocument | undefined> {
		const updated = transform(this.state.get(key));
		if (updated === undefined) {
			this.state.delete(key);
			return undefined;
		}
		this.state.set(key, updated);
		return updated;
	}

	public async getAsync(key: string): Promise<StoredProfileDocument | undefined> {
		return this.state.get(key);
	}

	public async setAsync(key: string, value: StoredProfileDocument): Promise<void> {
		this.state.set(key, value);
	}

	public async removeAsync(key: string): Promise<void> {
		this.state.delete(key);
	}
}

export class MockMessageBusAdapter implements IMessageBusAdapter {
	private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

	public async publish(profileKey: string, payload: unknown): Promise<void> {
		const topic = topicName(profileKey);
		const listeners = this.handlers.get(topic);
		if (!listeners) return;
		for (const listener of listeners) {
			task.spawn(() => listener(payload));
		}
	}

	public async subscribe(
		profileKey: string,
		handler: (payload: unknown) => void,
	): Promise<RBXScriptConnection | undefined> {
		const topic = topicName(profileKey);
		const listeners = this.handlers.get(topic) ?? new Set<(payload: unknown) => void>();
		listeners.add(handler);
		this.handlers.set(topic, listeners);

		const connection = {
			Connected: true,
			Disconnect: () => {
				listeners.delete(handler);
			},
		} as unknown as RBXScriptConnection;

		return connection;
	}
}

export function sameSession(a?: SessionTag, b?: SessionTag): boolean {
	if (!a || !b) return false;
	return a.placeId === b.placeId && a.jobId === b.jobId && a.sessionId === b.sessionId;
}
