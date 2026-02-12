import {getVersion as getTauriVersion} from '@tauri-apps/api/app';
import {invoke as tauriInvoke} from '@tauri-apps/api/core';
import {listen as tauriListen} from '@tauri-apps/api/event';
import {
	openPath as tauriOpenPath,
	openUrl as tauriOpenUrl,
} from '@tauri-apps/plugin-opener';

type EventListener<T> = (event: {payload: T}) => void;
type Unlisten = () => void;

type HostInvokeResponse = {
	ok: boolean;
	data?: unknown;
	error?: string;
};

const runtimeWindow = globalThis as typeof globalThis & {
	__TAURI_INTERNALS__?: unknown;
};

export const isTauriRuntime = Boolean(runtimeWindow.__TAURI_INTERNALS__);

const hostBaseUrl = (
	import.meta.env.VITE_SYMPHONY_HOST_URL as string | undefined
)?.trim();
const inferredHostName =
	globalThis.window === undefined
		? '127.0.0.1'
		: globalThis.window.location.hostname;
const resolvedHostBaseUrl =
	hostBaseUrl || `http://${inferredHostName || '127.0.0.1'}:48678`;

const listenersByEvent = new Map<string, Set<EventListener<unknown>>>();
let eventSource: EventSource | undefined;
let lastKnownEventUrl = '';

function ensureEventSource() {
	const nextEventUrl = `${resolvedHostBaseUrl}/api/events`;
	if (eventSource && lastKnownEventUrl === nextEventUrl) return;
	if (eventSource) eventSource.close();

	lastKnownEventUrl = nextEventUrl;
	eventSource = new EventSource(nextEventUrl);

	eventSource.addEventListener('error', error => {
		console.error('Host event stream error', error);
	});
}

function registerBrowserEventListener<T>(
	eventName: string,
	handler: EventListener<T>,
): Unlisten {
	ensureEventSource();
	let listeners = listenersByEvent.get(eventName);
	if (!listeners) {
		listeners = new Set();
		listenersByEvent.set(eventName, listeners);
		eventSource?.addEventListener(
			eventName,
			(message: MessageEvent<string>) => {
				let payload: unknown;
				try {
					payload = JSON.parse(message.data);
				} catch {
					payload = message.data;
				}
				const subscribers = listenersByEvent.get(eventName);
				if (!subscribers || subscribers.size === 0) return;
				for (const listener of subscribers) {
					listener({payload});
				}
			},
		);
	}
	listeners.add(handler as EventListener<unknown>);

	return () => {
		const registeredListeners = listenersByEvent.get(eventName);
		if (!registeredListeners) return;
		registeredListeners.delete(handler as EventListener<unknown>);
		if (registeredListeners.size === 0) {
			listenersByEvent.delete(eventName);
		}
	};
}

export async function invoke<T>(
	command: string,
	arguments_: unknown = {},
): Promise<T> {
	if (isTauriRuntime) {
		const tauriArguments =
			arguments_ && typeof arguments_ === 'object'
				? (arguments_ as Record<string, unknown>)
				: undefined;
		return tauriInvoke<T>(command, tauriArguments);
	}

	const response = await fetch(`${resolvedHostBaseUrl}/api/invoke`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			command,
			args: arguments_,
		}),
	});
	if (!response.ok) {
		throw new Error(`Bridge request failed: HTTP ${response.status}`);
	}

	const payload = (await response.json()) as HostInvokeResponse;
	if (!payload.ok) {
		throw new Error(payload.error || `Command failed: ${command}`);
	}
	return payload.data as T;
}

export async function listen<T>(
	eventName: string,
	handler: EventListener<T>,
): Promise<Unlisten> {
	if (isTauriRuntime) {
		return tauriListen(eventName, handler);
	}

	return registerBrowserEventListener(eventName, handler);
}

export async function getVersion(): Promise<string> {
	if (isTauriRuntime) return getTauriVersion();
	try {
		const response = await fetch(`${resolvedHostBaseUrl}/health`);
		if (response.ok) return 'hosted-web';
	} catch {
		// Fall through and keep a stable fallback version string.
	}
	return 'web';
}

export async function openUrl(url: string): Promise<void> {
	if (isTauriRuntime) {
		await tauriOpenUrl(url);
		return;
	}
	window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPath(path: string): Promise<void> {
	if (isTauriRuntime) {
		await tauriOpenPath(path);
		return;
	}
	await invoke('open_in_file_manager', {path});
}
