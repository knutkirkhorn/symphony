import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, URL} from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';

const host = process.env.TAURI_DEV_HOST;
const isLoopbackHost = (value: string) =>
	value === 'localhost' || value === '127.0.0.1' || value === '::1';
const resolvedDevelopmentHost =
	host && !isLoopbackHost(host) ? host : '0.0.0.0';

function getHostAccessSettingsPath() {
	if (process.env.SYMPHONY_HOST_ACCESS_SETTINGS_PATH) {
		return process.env.SYMPHONY_HOST_ACCESS_SETTINGS_PATH;
	}
	if (process.platform === 'darwin') {
		return path.join(
			os.homedir(),
			'Library',
			'Application Support',
			'symphony',
			'host_access_settings.json',
		);
	}
	if (process.platform === 'win32') {
		const appData =
			process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
		return path.join(appData, 'symphony', 'host_access_settings.json');
	}
	const xdgDataHome =
		process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
	return path.join(xdgDataHome, 'symphony', 'host_access_settings.json');
}

function readAllowLanAccess() {
	try {
		const settingsPath = getHostAccessSettingsPath();
		const contents = fs.readFileSync(settingsPath, 'utf8');
		const parsed = JSON.parse(contents) as {allowLanAccess?: unknown};
		return parsed.allowLanAccess === true;
	} catch {
		return false;
	}
}

function isLoopbackAddress(remoteAddress: string | undefined) {
	if (!remoteAddress) return false;
	return (
		remoteAddress === '127.0.0.1' ||
		remoteAddress === '::1' ||
		remoteAddress.startsWith('::ffff:127.')
	);
}

function nonLocalDevelopmentAccessGuardPlugin(): Plugin {
	return {
		name: 'symphony-non-local-dev-access-guard',
		configureServer(server) {
			server.middlewares.use((request, _response, next) => {
				const remoteAddress = request.socket.remoteAddress;
				if (isLoopbackAddress(remoteAddress) || readAllowLanAccess()) {
					next();
					return;
				}

				// Drop non-local requests so frontend is unreachable over LAN when disabled.
				request.socket.destroy();
			});
		},
	};
}

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react(), tailwindcss(), nonLocalDevelopmentAccessGuardPlugin()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('src', import.meta.url)),
		},
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: resolvedDevelopmentHost,
		hmr:
			host && !isLoopbackHost(host)
				? {
						protocol: 'ws',
						host,
						port: 1421,
					}
				: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ['**/src-tauri/**'],
		},
	},
}));
