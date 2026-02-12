/* eslint-disable unicorn/no-useless-undefined */
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
const WEB_AUTH_TOKEN_STORAGE_KEY = 'symphony:web-auth-token';

const listenersByEvent = new Map<string, Set<EventListener<unknown>>>();
let eventSource: EventSource | undefined;
let lastKnownEventUrl = '';
let webAuthTokenCache: string | undefined;

function loadStoredWebAuthToken() {
	if (isTauriRuntime) return undefined;
	try {
		const token = localStorage.getItem(WEB_AUTH_TOKEN_STORAGE_KEY) ?? undefined;
		return token?.trim() || undefined;
	} catch {
		return undefined;
	}
}

function getRequiredWebAuthToken(): string {
	if (isTauriRuntime) {
		throw new Error('Web auth token is not used in Tauri runtime');
	}
	if (webAuthTokenCache === undefined) {
		webAuthTokenCache = loadStoredWebAuthToken();
	}
	if (!webAuthTokenCache) {
		throw new Error('Authentication required');
	}
	return webAuthTokenCache;
}

function ensureEventSource() {
	const token = getRequiredWebAuthToken();
	const nextEventUrl = `${resolvedHostBaseUrl}/api/events?token=${encodeURIComponent(token)}`;
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
	const token = getRequiredWebAuthToken();

	const response = await fetch(`${resolvedHostBaseUrl}/api/invoke`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
			'x-symphony-token': token,
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
	return 'hosted-web';
}

export function getWebAuthToken() {
	if (isTauriRuntime) return undefined;
	if (webAuthTokenCache === undefined) {
		webAuthTokenCache = loadStoredWebAuthToken();
	}
	return webAuthTokenCache;
}

export function setWebAuthToken(token: string | undefined) {
	if (isTauriRuntime) return;
	webAuthTokenCache = token?.trim() || undefined;
	if (eventSource) {
		eventSource.close();
		eventSource = undefined;
		lastKnownEventUrl = '';
	}
	try {
		if (webAuthTokenCache) {
			localStorage.setItem(WEB_AUTH_TOKEN_STORAGE_KEY, webAuthTokenCache);
		} else {
			localStorage.removeItem(WEB_AUTH_TOKEN_STORAGE_KEY);
		}
	} catch {
		// Ignore storage errors in restricted environments.
	}
}

export async function verifyWebAuthToken(token: string): Promise<boolean> {
	if (isTauriRuntime) return true;
	const normalizedToken = token.trim();
	if (!normalizedToken) return false;
	try {
		const response = await fetch(`${resolvedHostBaseUrl}/api/auth/verify`, {
			headers: {
				authorization: `Bearer ${normalizedToken}`,
				'x-symphony-token': normalizedToken,
			},
		});
		return response.ok;
	} catch {
		return false;
	}
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
