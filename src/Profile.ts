import Signal = require('@rbxts/signal');
import { FossixStore } from './FossixStore';
import { LastSaveReason } from './types';
import { deepCopy, reconcile } from './internal/deep';

export class Profile<T extends object> {
	public readonly OnSave = new Signal<() => void>();
	public readonly OnLastSave = new Signal<(reason: LastSaveReason) => void>();
	public readonly OnSessionEnd = new Signal<() => void>();
	public readonly OnAfterSave = new Signal<(lastSavedData: T) => void>();
	private messageHandler?: (message: unknown, processed: () => void) => void;

	public readonly ProfileStore: FossixStore<T>;
	public readonly Key: string;
	public readonly FirstSessionTime: number;
	public readonly SessionLoadCount: number;

	public Data: T;
	public LastSavedData: T;
	public RobloxMetaData?: defined;
	public readonly UserIds = new Set<number>();

	public constructor(
		store: FossixStore<T>,
		key: string,
		initialData: T,
		sessionLoadCount: number,
		firstSessionTime: number,
		userIds: number[],
		robloxMetaData?: defined,
	) {
		this.ProfileStore = store;
		this.Key = key;
		this.Data = initialData;
		this.LastSavedData = deepCopy(initialData);
		this.SessionLoadCount = sessionLoadCount;
		this.FirstSessionTime = firstSessionTime;
		this.RobloxMetaData = robloxMetaData;
		userIds.forEach((userId) => this.UserIds.add(userId));
	}

	public IsActive(): boolean {
		return this.ProfileStore.isProfileActive(this.Key);
	}

	public Reconcile(template?: T): void {
		const targetTemplate = template ?? this.ProfileStore.getTemplate();
		if (!targetTemplate) {
			return;
		}
		reconcile(this.Data, targetTemplate);
	}

	public EndSession(): Promise<void> {
		return this.ProfileStore.endSessionInternal(this, 'Manual');
	}

	public Save(): Promise<boolean> {
		return this.ProfileStore.saveProfileInternal(this, false, 'Manual');
	}

	public SetAsync(): Promise<boolean> {
		return this.ProfileStore.setProfileInternal(this);
	}

	public AddUserId(userId: number): void {
		this.UserIds.add(userId);
	}

	public RemoveUserId(userId: number): void {
		this.UserIds.delete(userId);
	}

	public MessageHandler(
		handler: (message: unknown, processed: () => void) => void,
	): void {
		this.messageHandler = handler;
	}

	public dispatchMessage(message: unknown): void {
		const handler = this.messageHandler;
		if (!handler) return;
		handler(message, () => undefined);
	}

	public setLastSavedData(snapshot: T): void {
		this.LastSavedData = snapshot;
	}
}
