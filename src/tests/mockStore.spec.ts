/// <reference types="@rbxts/testez/globals" />

import { FossixStore } from '../FossixStore';
import { MockDataStoreAdapter, MockMessageBusAdapter } from '../internal/adapters';

interface TestData {
	coins: number;
}

describe('FossixStore (mock)', () => {
	describe('persistence', () => {
		it('saves and loads profile data', () => {
			const dataStore = new MockDataStoreAdapter();
			const bus = new MockMessageBusAdapter();

			const store = FossixStore.createStore<TestData>(
				'SpecStore',
				{ coins: 0 },
				{ dataStoreAdapter: dataStore, messageBusAdapter: bus, useMock: true },
			);

			const profile = store.StartSessionAsync('player_1').expect();
			expect(profile).to.be.ok();

			if (!profile) {
				return;
			}

			profile.Data.coins = 25;
			profile.Save().expect();
			profile.EndSession().expect();

			const loaded = store.GetAsync('player_1').expect();
			expect(loaded).to.be.ok();
			expect(loaded!.Data.coins).to.equal(25);
		});
	});

	describe('session conflict', () => {
		it('does not allow a second session on the same key without steal', () => {
			const sharedDataStore = new MockDataStoreAdapter();
			const sharedBus = new MockMessageBusAdapter();

			const storeA = FossixStore.createStore<TestData>(
				'ConflictStore',
				{ coins: 0 },
				{ dataStoreAdapter: sharedDataStore, messageBusAdapter: sharedBus, useMock: true },
			);
			const storeB = FossixStore.createStore<TestData>(
				'ConflictStore',
				{ coins: 0 },
				{ dataStoreAdapter: sharedDataStore, messageBusAdapter: sharedBus, useMock: true },
			);

			const profileA = storeA.StartSessionAsync('same_key').expect();
			expect(profileA).to.be.ok();

			const profileB = storeB
				.StartSessionAsync('same_key', { steal: false, cancel: () => true })
				.expect();
			expect(profileB).to.equal(undefined);

			if (profileA) {
				profileA.EndSession().expect();
			}
		});
	});
});
