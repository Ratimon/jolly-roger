import {init} from 'web3-connection';
import {contractsInfos, defaultRPC, initialContractsInfos, blockTime, localRPC} from '$lib/config';
import {initAccountData} from './account-data';
import {initTransactionProcessor} from 'ethereum-tx-observer';
import {initViemContracts} from 'web3-connection-viem';
import {logs} from 'named-logs';
import {stringToHex} from 'viem';

const logger = logs('jolly-roger');

export const accountData = initAccountData();

// TODO we need to hook tx-observer with a provider and make it process tx

// does not connect through node, so only enable devNetwork when in the browser
const devNetwork =
	typeof window != 'undefined' && localRPC
		? {
				url: localRPC.url,
				chainId: localRPC.chainId,
				checkCacheIssues: true,
		  }
		: undefined;

const stores = init({
	autoConnectUsingPrevious: true,
	options: ['builtin'],
	parameters: {
		blockTime: blockTime || 5,
		finality: 12, // TODO
	},
	defaultRPC,
	networks: initialContractsInfos,
	provider: {
		errorOnTimeDifference: false,
	},
	observers: {
		onTxSent(tx, hash) {
			accountData.onTxSent(tx, hash as `0x{string}`); // TODO web3-connection 0x{string}
		},
	},
	acccountData: {
		async loadWithNetworkConnected(state, setLoadingMessage, waitForStep) {
			console.log({loading: '...'});
			const chainId = state.network.chainId;
			const address = state.address;

			let signature: `0x${string}` | undefined;

			const private_signature_storageKey = `__private_signature__${address.toLowerCase()}`;
			try {
				const fromStorage = localStorage.getItem(private_signature_storageKey);
				if (fromStorage && fromStorage.startsWith('0x')) {
					signature = fromStorage as `0x${string}`;
				}
			} catch (err) {}

			let remoteSyncEnabled: boolean = true;
			const remoteSync_storageKey = `__remoteSync_${address.toLowerCase}`;
			try {
				const fromStorage = localStorage.getItem(remoteSync_storageKey);
				if (fromStorage === 'true') {
					remoteSyncEnabled = true;
				} else if (fromStorage === 'false') {
					remoteSyncEnabled = false;
				}
			} catch (err) {}

			if (!signature) {
				async function signMessage() {
					const msg = stringToHex(
						'Welcome to Jolly-Roger, Please sign this message only on trusted frontend. This gives access to your local data that you are supposed to keep secret.',
					);
					const signature = await state.connection.provider
						.request({
							method: 'personal_sign',
							params: [msg, address],
						})
						.catch((e: any) => {
							account.rejectLoadingStep();
						});
					account.acceptLoadingStep(signature);
				}
				// setLoadingMessage('Please Sign The Authentication Message To Go Forward');

				console.log({remoteSyncEnabled});
				const {doNotAskAgainSignature, remoteSyncEnabled: remoteSyncEnabledAsked} = (await waitForStep('WELCOME', {
					remoteSyncEnabled,
				})) as {
					remoteSyncEnabled: boolean;
					doNotAskAgainSignature: boolean;
				};
				remoteSyncEnabled = remoteSyncEnabledAsked;
				try {
					localStorage.setItem(remoteSync_storageKey, remoteSyncEnabled ? 'true' : 'false');
				} catch (err) {}
				signMessage();
				signature = (await waitForStep('SIGNING')) as `0x${string}`;
				if (doNotAskAgainSignature) {
					try {
						localStorage.setItem(private_signature_storageKey, signature);
					} catch (err) {}
				}
			}
			await accountData.load({
				address,
				chainId,
				genesisHash: state.network.genesisHash || '',
				privateSignature: signature,
			});
		},
		async unload() {
			console.log({unloading: '...'});
			await accountData.unload();
		},
	},
	devNetwork,
});

export const txObserver = initTransactionProcessor({finality: 12}); // TODO config.finality

// we hook up accountData and txObserver
// they do not need to know about each other
// except that account data follow the same type of "pending tx" as input/output
// but accountData can be strucutred as it wishes otherwise. just need to emit an event for "clear" and "newTx"
// and since accountData implement load and unload and is passed to web3-connection, these load and unload will be called automatically
accountData.on((event) => {
	switch (event.name) {
		case 'clear':
			txObserver.clear();
			break;
		case 'newTx':
			txObserver.add(event.txs);
			break;
	}
});
txObserver.onTx((v) => {
	logger.info(`onTx ${v.hash}`);
	accountData.updateTx(v);
});
stores.connection.onNewBlock(() => {
	logger.info(`onNewBlock`);
	txObserver.process();
});
stores.connection.subscribe(($connection) => {
	if ($connection.provider) {
		txObserver.setProvider($connection.provider);
	}
});

contractsInfos.subscribe((contractsInfos) => {
	stores.connection.updateContractsInfos(contractsInfos);
});

export const {connection, network, account, pendingActions, execution, execute, devProvider} = stores;

export const contracts = initViemContracts(execute);

if (typeof window !== 'undefined') {
	(window as any).execution = execution;
	(window as any).connection = connection;
	(window as any).network = network;
	(window as any).account = account;
	(window as any).pendingActions = pendingActions;

	(window as any).accountData = accountData;
}
