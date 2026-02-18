/* eslint-disable unicorn/no-null */
import {ChangedFilesView} from '@/components/changed-files-view';
import {EmptyState} from '@/components/empty-state';
import {GitHistoryView} from '@/components/git-history-view';
import {RepoAgentsView} from '@/components/repo-agents-view';
import {RepoSidebar} from '@/components/repo-sidebar';
import {SettingsView} from '@/components/settings-view';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from '@/components/ui/sidebar';
import {Toaster} from '@/components/ui/sonner';
import {
	getVersion,
	getWebAuthToken,
	invoke,
	isTauriRuntime,
	listen,
	openPath,
	openUrl,
	setWebAuthToken,
	verifyWebAuthToken,
} from '@/lib/host-bridge';
import type {
	Agent,
	AgentConversationEntry,
	GitCommit,
	GitCommitFileDiff,
	Group,
	Repo,
	RepoSyncStatus,
} from '@/lib/types';
import {
	ExternalLink,
	FolderOpen,
	GitBranch,
	SquareTerminal,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {toast} from 'sonner';

type RemoteInfo = {
	provider: 'github' | 'gitlab';
	url: string;
};

type RepoViewTab = 'agent' | 'changed-files' | 'commit-log';
type AppView = 'repo' | 'settings';
type HostAuthState = 'checking' | 'unauthorized' | 'authorized';

type AgentStreamPayload = {
	runId: string;
	agentId: number;
	line: string;
};

type AgentDonePayload = {
	runId: string;
	agentId: number;
	success: boolean;
};

type AgentStreamPayloadWire = AgentStreamPayload & {
	run_id?: string;
	agent_id?: number;
};

type AgentDonePayloadWire = AgentDonePayload & {
	run_id?: string;
	agent_id?: number;
};

type AgentStreamRecord = {
	type?: string;
	subtype?: string;
	text?: string;
};

type ToolCallLifecycleRecord = {
	type: 'tool_call';
	subtype?: string;
	tool_call?: {
		editToolCall?: {args?: {path?: string}};
	};
};

type SystemInitRecord = {
	type: 'system';
	subtype?: string;
	model?: string;
};

type HostAccessSettings = {
	allowLanAccess: boolean;
};

function isMacOS() {
	if (typeof navigator === 'undefined') return false;
	const platform = navigator.platform.toUpperCase();
	return platform.includes('MAC') || /Mac/.test(navigator.userAgent);
}

const SHORTCUT_MODIFIER_LABEL = isMacOS() ? 'Cmd' : 'Ctrl';
const SIMULATOR_MODE_STORAGE_KEY = 'symphony:simulator-mode';
const RAW_LOGS_STORAGE_KEY = 'symphony:raw-logs';
const ACCESS_TOKEN_QUERY_PARAM = 'access_token';

function randomRunId() {
	if ('randomUUID' in crypto) return crypto.randomUUID();
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getAccessTokenFromQueryParameter() {
	if (globalThis.window === undefined) return null;
	const searchParameters = new URLSearchParams(
		globalThis.window.location.search,
	);
	const token = searchParameters.get(ACCESS_TOKEN_QUERY_PARAM)?.trim();
	if (!token) return null;
	return token;
}

function removeAccessTokenFromQueryParameter() {
	if (globalThis.window === undefined) return;
	const url = new URL(globalThis.window.location.href);
	if (!url.searchParams.has(ACCESS_TOKEN_QUERY_PARAM)) return;
	url.searchParams.delete(ACCESS_TOKEN_QUERY_PARAM);
	globalThis.window.history.replaceState({}, document.title, url.toString());
}

function parseAgentConversationLine(
	rawLine: string,
): Omit<AgentConversationEntry, 'id'> | null {
	const line = rawLine.trim();
	if (!line) return null;

	try {
		const data: unknown = JSON.parse(line);
		if (!data || typeof data !== 'object') {
			return {
				role: 'system',
				text: line,
			};
		}

		const record = data as {
			type?: string;
			subtype?: string;
			message?: {content?: Array<{type?: string; text?: string}>};
			tool_call?: {
				shellToolCall?: {args?: {command?: string}};
				editToolCall?: {args?: {path?: string}};
			};
			result?: string;
			is_error?: boolean;
		};

		if (record.type === 'user') {
			const text =
				record.message?.content
					?.filter(content => content.type === 'text')
					.map(content => content.text)
					.filter(Boolean)
					.join('\n') ?? '';
			if (text) return {role: 'user', text};
		}

		if (record.type === 'assistant') {
			const text =
				record.message?.content
					?.filter(content => content.type === 'text')
					.map(content => content.text)
					.filter(Boolean)
					.join('\n') ?? '';
			if (text) return {role: 'assistant', text};
		}

		if (record.type === 'system' && record.subtype === 'init') {
			return null;
		}

		if (record.type === 'tool_call' && record.subtype === 'started') {
			const command = record.tool_call?.shellToolCall?.args?.command;
			if (command) return {role: 'tool', text: `Running: ${command}`};
			if (record.tool_call?.editToolCall?.args?.path) return null;
			return {role: 'tool', text: 'Tool call started'};
		}

		if (record.type === 'tool_call' && record.subtype === 'completed') {
			return null;
		}

		if (record.type === 'result') {
			const text = record.result?.trim() || 'Agent finished';
			return {role: record.is_error ? 'error' : 'system', text};
		}

		return {role: 'system', text: line};
	} catch {
		return {role: 'system', text: line};
	}
}

function parseSystemInitRecord(rawLine: string) {
	try {
		const data: unknown = JSON.parse(rawLine);
		if (!data || typeof data !== 'object') return null;
		const record = data as SystemInitRecord;
		if (record.type !== 'system' || record.subtype !== 'init') return null;
		const model = record.model?.trim();
		return model ? {model} : {model: null};
	} catch {
		return null;
	}
}

function parseAgentStreamRecord(rawLine: string): AgentStreamRecord | null {
	try {
		const data: unknown = JSON.parse(rawLine);
		if (!data || typeof data !== 'object') return null;
		return data as AgentStreamRecord;
	} catch {
		return null;
	}
}

function parseEditToolCallLifecycle(rawLine: string) {
	try {
		const data: unknown = JSON.parse(rawLine);
		if (!data || typeof data !== 'object') return null;
		const record = data as ToolCallLifecycleRecord;
		if (record.type !== 'tool_call') return null;
		const path = record.tool_call?.editToolCall?.args?.path?.trim();
		if (record.subtype === 'started' && path) {
			return {event: 'started' as const, path};
		}
		if (record.subtype === 'completed') {
			return {event: 'completed' as const, path: path || null};
		}
		return null;
	} catch {
		return null;
	}
}

async function openRemoteInBrowser(remoteInfo: RemoteInfo) {
	try {
		await openUrl(remoteInfo.url);
	} catch (error) {
		toast.error(String(error));
	}
}

function App() {
	const [repos, setRepos] = useState<Repo[]>([]);
	const [groups, setGroups] = useState<Group[]>([]);
	const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
	const [remoteInfo, setRemoteInfo] = useState<RemoteInfo | null>(null);
	const [selectedRepoBranch, setSelectedRepoBranch] = useState<string | null>(
		null,
	);
	const [activeView, setActiveView] = useState<AppView>('repo');
	const [activeRepoViewTab, setActiveRepoViewTab] =
		useState<RepoViewTab>('agent');
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [isVersionLoading, setIsVersionLoading] = useState(true);
	const [versionError, setVersionError] = useState<string | null>(null);
	const [hostAuthState, setHostAuthState] = useState<HostAuthState>(
		isTauriRuntime ? 'authorized' : 'checking',
	);
	const [hostAuthTokenInput, setHostAuthTokenInput] = useState('');
	const [hostAuthError, setHostAuthError] = useState<string | null>(null);
	const [isSimulatorMode, setIsSimulatorMode] = useState<boolean>(() => {
		try {
			return localStorage.getItem(SIMULATOR_MODE_STORAGE_KEY) === 'true';
		} catch {
			return false;
		}
	});
	const [showRawLogs, setShowRawLogs] = useState<boolean>(() => {
		try {
			return localStorage.getItem(RAW_LOGS_STORAGE_KEY) === 'true';
		} catch {
			return false;
		}
	});
	const [hostLanAccessEnabled, setHostLanAccessEnabled] = useState(false);
	const [lanListenUrl, setLanListenUrl] = useState<string | null>(null);
	const [isHostLanAccessLoading, setIsHostLanAccessLoading] = useState(false);
	const [agentsByRepoId, setAgentsByRepoId] = useState<Record<number, Agent[]>>(
		{},
	);
	const [agentsLoadingByRepoId, setAgentsLoadingByRepoId] = useState<
		Record<number, boolean>
	>({});
	const [agentsErrorByRepoId, setAgentsErrorByRepoId] = useState<
		Record<number, string | null>
	>({});
	const [isCreatingAgentRepoId, setIsCreatingAgentRepoId] = useState<
		number | null
	>(null);
	const [isDeletingAgentId, setIsDeletingAgentId] = useState<number | null>(
		null,
	);
	const [isRenamingAgentId, setIsRenamingAgentId] = useState<number | null>(
		null,
	);
	const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
	const [agentPrompt, setAgentPrompt] = useState('');
	const [runningAgentIds, setRunningAgentIds] = useState<number[]>([]);
	const [agentMessagesById, setAgentMessagesById] = useState<
		Record<number, AgentConversationEntry[]>
	>({});
	const [agentLogsById, setAgentLogsById] = useState<Record<number, string[]>>(
		{},
	);
	const [agentModelById, setAgentModelById] = useState<Record<number, string>>(
		{},
	);
	const [historyCommits, setHistoryCommits] = useState<GitCommit[]>([]);
	const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(
		null,
	);
	const [selectedCommitDiffs, setSelectedCommitDiffs] = useState<
		GitCommitFileDiff[]
	>([]);
	const [isHistoryLoading, setIsHistoryLoading] = useState(false);
	const [isDiffLoading, setIsDiffLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [diffError, setDiffError] = useState<string | null>(null);
	const [repoSyncStatusById, setRepoSyncStatusById] = useState<
		Record<number, RepoSyncStatus>
	>({});
	const [repoBranchById, setRepoBranchById] = useState<Record<number, string>>(
		{},
	);
	const [isCheckingRepoUpdates, setIsCheckingRepoUpdates] = useState(false);
	const remoteRequestIdReference = useRef(0);
	const historyRequestIdReference = useRef(0);
	const diffRequestIdReference = useRef(0);
	const agentsRequestIdReference = useRef(0);
	const branchesRequestIdReference = useRef(0);
	const thinkingMessageIdByAgentReference = useRef<Record<number, string>>({});
	const pendingEditedPathByAgentReference = useRef<Record<number, string>>({});
	const isRuntimeAuthorized = isTauriRuntime || hostAuthState === 'authorized';

	const authenticateHostToken = useCallback(async (token: string) => {
		if (isTauriRuntime) return true;
		const normalizedToken = token.trim();
		if (!normalizedToken) return false;
		const isValid = await verifyWebAuthToken(normalizedToken);
		if (isValid) {
			setWebAuthToken(normalizedToken);
			setHostAuthState('authorized');
			setHostAuthError(null);
			return true;
		}
		setWebAuthToken(undefined);
		setHostAuthState('unauthorized');
		setHostAuthError('Invalid token');
		return false;
	}, []);

	const loadHostAccessSettings = useCallback(async () => {
		if (!isRuntimeAuthorized) return;
		setIsHostLanAccessLoading(true);
		try {
			const result = await invoke<HostAccessSettings>(
				'get_host_access_settings',
			);
			setHostLanAccessEnabled(result.allowLanAccess);
			if (result.allowLanAccess && isTauriRuntime) {
				const url = await invoke<string | null>('get_lan_listen_url');
				setLanListenUrl(url ?? null);
			} else {
				setLanListenUrl(null);
			}
		} catch (error) {
			console.error('Failed to load host access settings:', error);
		} finally {
			setIsHostLanAccessLoading(false);
		}
	}, [isRuntimeAuthorized]);

	const updateHostLanAccess = useCallback(async (enabled: boolean) => {
		setIsHostLanAccessLoading(true);
		try {
			const result = await invoke<HostAccessSettings>(
				'set_host_access_settings',
				{
					allowLanAccess: enabled,
				},
			);
			setHostLanAccessEnabled(result.allowLanAccess);
			if (result.allowLanAccess && isTauriRuntime) {
				const url = await invoke<string | null>('get_lan_listen_url');
				setLanListenUrl(url ?? null);
			} else {
				setLanListenUrl(null);
			}
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsHostLanAccessLoading(false);
		}
	}, []);

	const openSelectedRepoInExplorer = useCallback(async () => {
		if (!selectedRepo) return;
		try {
			await openPath(selectedRepo.path);
		} catch (error) {
			toast.error(String(error));
		}
	}, [selectedRepo]);

	const openSelectedRepoInCursor = useCallback(async () => {
		if (!selectedRepo) return;
		try {
			await invoke('open_in_cursor', {
				path: selectedRepo.path,
			});
		} catch (error) {
			toast.error(String(error));
		}
	}, [selectedRepo]);

	const loadRepos = useCallback(async () => {
		if (!isRuntimeAuthorized) return;
		try {
			const result = await invoke<Repo[]>('list_repos');
			setRepos(result);
			setSelectedRepo(previousSelectedRepo => {
				if (!previousSelectedRepo) return null;
				return result.find(repo => repo.id === previousSelectedRepo.id) ?? null;
			});
		} catch (error) {
			console.error('Failed to load repos:', error);
		}
	}, [isRuntimeAuthorized]);

	const loadGroups = useCallback(async () => {
		if (!isRuntimeAuthorized) return;
		try {
			const result = await invoke<Group[]>('list_groups');
			setGroups(result);
		} catch (error) {
			console.error('Failed to load groups:', error);
		}
	}, [isRuntimeAuthorized]);

	const checkRepoUpdates = useCallback(
		async (fetch: boolean) => {
			if (!isRuntimeAuthorized) return;
			if (repos.length === 0) {
				setRepoSyncStatusById({});
				return;
			}

			setIsCheckingRepoUpdates(true);
			try {
				const entries = await Promise.all(
					repos.map(async repo => {
						try {
							const status = await invoke<RepoSyncStatus>(
								'get_repo_sync_status',
								{
									path: repo.path,
									fetch,
								},
							);
							return [repo.id, status] as const;
						} catch (error) {
							return [
								repo.id,
								{
									has_remote: false,
									has_upstream: false,
									ahead: 0,
									behind: 0,
									can_pull: false,
									error: String(error),
								},
							] as const;
						}
					}),
				);

				setRepoSyncStatusById(Object.fromEntries(entries));
			} finally {
				setIsCheckingRepoUpdates(false);
			}
		},
		[isRuntimeAuthorized, repos],
	);

	const pullRepo = useCallback(
		async (repo: Repo) => {
			try {
				const output = await invoke<string>('pull_repo', {
					path: repo.path,
				});
				toast.success(
					output.includes('Already up to date')
						? `${repo.name} is already up to date`
						: `Pulled changes for ${repo.name}`,
				);
			} catch (error) {
				toast.error(String(error));
				return;
			}

			void checkRepoUpdates(true);
			if (selectedRepo?.id === repo.id) {
				// Force history/diff effects to reload with the updated repository state.
				setSelectedRepo(previous =>
					previous ? {...previous, path: repo.path} : previous,
				);
			}
		},
		[checkRepoUpdates, selectedRepo],
	);

	const appendAgentMessage = useCallback(
		(agentId: number, message: Omit<AgentConversationEntry, 'id'>) => {
			setAgentMessagesById(previous => ({
				...previous,
				[agentId]: [
					...(previous[agentId] ?? []),
					{
						id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
						...message,
					},
				],
			}));
		},
		[],
	);

	const appendAgentLog = useCallback((agentId: number, line: string) => {
		setAgentLogsById(previous => ({
			...previous,
			[agentId]: [...(previous[agentId] ?? []), line],
		}));
	}, []);

	const appendThinkingDelta = useCallback(
		(agentId: number, deltaText: string) => {
			setAgentMessagesById(previous => {
				const existingMessages = previous[agentId] ?? [];
				const existingThinkingMessageId =
					thinkingMessageIdByAgentReference.current[agentId];
				const thinkingMessageId =
					existingThinkingMessageId ??
					`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				const thinkingIndex = existingMessages.findIndex(
					entry => entry.id === thinkingMessageId,
				);
				const sanitizedDelta = deltaText ?? '';
				const nextThinkingMessage: AgentConversationEntry = {
					id: thinkingMessageId,
					role: 'system',
					kind: 'thinking',
					isPending: true,
					text: sanitizedDelta || 'Thinking...',
				};
				const nextMessages =
					thinkingIndex === -1
						? [...existingMessages, nextThinkingMessage]
						: existingMessages.map((entry, index) =>
								index === thinkingIndex
									? ({
											...entry,
											kind: 'thinking',
											isPending: true,
											text:
												sanitizedDelta.length > 0
													? `${entry.text}${sanitizedDelta}`
													: entry.text,
										} as AgentConversationEntry)
									: entry,
							);
				thinkingMessageIdByAgentReference.current[agentId] = thinkingMessageId;
				return {
					...previous,
					[agentId]: nextMessages,
				};
			});
		},
		[],
	);

	const finalizeThinkingMessage = useCallback(
		(agentId: number, clearId = false) => {
			const thinkingMessageId =
				thinkingMessageIdByAgentReference.current[agentId];
			if (!thinkingMessageId) return;
			setAgentMessagesById(previous => {
				const existingMessages = previous[agentId] ?? [];
				const nextMessages = existingMessages.map(entry =>
					entry.id === thinkingMessageId ? {...entry, isPending: false} : entry,
				);
				return {
					...previous,
					[agentId]: nextMessages,
				};
			});
			if (clearId) {
				delete thinkingMessageIdByAgentReference.current[agentId];
			}
		},
		[],
	);

	useEffect(() => {
		if (isTauriRuntime) return;
		const queryToken = getAccessTokenFromQueryParameter();
		const savedToken = getWebAuthToken();
		const startupToken = queryToken ?? savedToken;
		if (queryToken) {
			setHostAuthTokenInput(queryToken);
		}
		if (!startupToken) {
			setHostAuthState('unauthorized');
			return;
		}
		setHostAuthState('checking');
		void authenticateHostToken(startupToken).then(isAuthenticated => {
			if (isAuthenticated && queryToken) {
				removeAccessTokenFromQueryParameter();
			}
		});
	}, [authenticateHostToken]);

	useEffect(() => {
		if (!isRuntimeAuthorized) return;
		loadRepos();
		loadGroups();
		loadHostAccessSettings();
	}, [isRuntimeAuthorized, loadRepos, loadGroups, loadHostAccessSettings]);

	useEffect(() => {
		(async () => {
			setIsVersionLoading(true);
			setVersionError(null);
			try {
				const version = await getVersion();
				setAppVersion(version);
			} catch (error) {
				setVersionError(String(error));
			} finally {
				setIsVersionLoading(false);
			}
		})();
	}, []);

	useEffect(() => {
		try {
			localStorage.setItem(
				SIMULATOR_MODE_STORAGE_KEY,
				isSimulatorMode ? 'true' : 'false',
			);
		} catch {
			// Ignore storage errors (private mode / restricted environments).
		}
	}, [isSimulatorMode]);

	useEffect(() => {
		try {
			localStorage.setItem(
				RAW_LOGS_STORAGE_KEY,
				showRawLogs ? 'true' : 'false',
			);
		} catch {
			// Ignore storage errors (private mode / restricted environments).
		}
	}, [showRawLogs]);

	useEffect(() => {
		if (!isRuntimeAuthorized) return;
		void checkRepoUpdates(false);
	}, [isRuntimeAuthorized, checkRepoUpdates]);

	// Fetch remote info whenever selectedRepo changes
	useEffect(() => {
		if (!isRuntimeAuthorized) return;
		if (!selectedRepo) {
			setRemoteInfo(null);
			setSelectedRepoBranch(null);
			setActiveRepoViewTab('agent');
			setSelectedAgentId(null);
			setAgentPrompt('');
			setRunningAgentIds([]);
			setAgentMessagesById({});
			setAgentLogsById({});
			setAgentModelById({});
			thinkingMessageIdByAgentReference.current = {};
			pendingEditedPathByAgentReference.current = {};
			return;
		}

		remoteRequestIdReference.current += 1;
		const requestId = remoteRequestIdReference.current;

		(async () => {
			const [info, branch] = await Promise.all([
				invoke<RemoteInfo | null>('get_remote_url', {
					path: selectedRepo.path,
				}).catch(() => null),
				invoke<string>('get_current_branch', {
					path: selectedRepo.path,
				}).catch(() => null),
			]);
			if (requestId !== remoteRequestIdReference.current) return;
			setRemoteInfo(info);
			setSelectedRepoBranch(branch);
		})();
	}, [isRuntimeAuthorized, selectedRepo]);

	useEffect(() => {
		if (!isRuntimeAuthorized) return;
		if (repos.length === 0) {
			setRepoBranchById({});
			return;
		}

		branchesRequestIdReference.current += 1;
		const requestId = branchesRequestIdReference.current;

		(async () => {
			const results = await Promise.allSettled(
				repos.map(async repo => {
					const branch = await invoke<string>('get_current_branch', {
						path: repo.path,
					});
					return [repo.id, branch] as const;
				}),
			);
			if (requestId !== branchesRequestIdReference.current) return;

			const nextBranchesById: Record<number, string> = {};
			for (const result of results) {
				if (result.status !== 'fulfilled') continue;
				const [repoId, branch] = result.value;
				if (typeof branch === 'string' && branch.trim().length > 0) {
					nextBranchesById[repoId] = branch;
				}
			}
			setRepoBranchById(nextBranchesById);
		})();
	}, [isRuntimeAuthorized, repos]);

	useEffect(() => {
		if (!isRuntimeAuthorized) return;
		if (repos.length === 0) {
			setAgentsByRepoId({});
			setAgentsLoadingByRepoId({});
			setAgentsErrorByRepoId({});
			return;
		}

		agentsRequestIdReference.current += 1;
		const requestId = agentsRequestIdReference.current;
		setAgentsLoadingByRepoId(
			Object.fromEntries(repos.map(repo => [repo.id, true])),
		);
		setAgentsErrorByRepoId(
			Object.fromEntries(repos.map(repo => [repo.id, null])),
		);

		(async () => {
			const results = await Promise.allSettled(
				repos.map(async repo => {
					const repoAgents = await invoke<Agent[]>('list_agents', {
						repoId: repo.id,
					});
					return [repo.id, repoAgents] as const;
				}),
			);
			if (requestId !== agentsRequestIdReference.current) return;

			const nextAgentsByRepoId: Record<number, Agent[]> = {};
			const nextErrorsByRepoId: Record<number, string | null> = {};
			for (const [index, result] of results.entries()) {
				const repoId = repos[index]?.id;
				if (!repoId) continue;
				if (result.status === 'fulfilled') {
					nextAgentsByRepoId[repoId] = result.value[1];
					nextErrorsByRepoId[repoId] = null;
				} else {
					nextAgentsByRepoId[repoId] = [];
					nextErrorsByRepoId[repoId] = String(result.reason);
				}
			}

			setAgentsByRepoId(nextAgentsByRepoId);
			setAgentsErrorByRepoId(nextErrorsByRepoId);
			setAgentsLoadingByRepoId(
				Object.fromEntries(repos.map(repo => [repo.id, false])),
			);
		})();
	}, [isRuntimeAuthorized, repos]);

	useEffect(() => {
		if (!isRuntimeAuthorized) return;
		if (!selectedRepo) {
			setSelectedAgentId(null);
			return;
		}

		const selectedRepoAgents = agentsByRepoId[selectedRepo.id] ?? [];
		setSelectedAgentId(previous =>
			previous && selectedRepoAgents.some(agent => agent.id === previous)
				? previous
				: (selectedRepoAgents[0]?.id ?? null),
		);
	}, [selectedRepo, agentsByRepoId]);

	useEffect(() => {
		if (!selectedRepo) {
			setHistoryCommits([]);
			setSelectedCommitHash(null);
			setHistoryError(null);
			return;
		}

		historyRequestIdReference.current += 1;
		const requestId = historyRequestIdReference.current;
		setIsHistoryLoading(true);
		setHistoryError(null);
		setHistoryCommits([]);
		setSelectedCommitHash(null);
		setSelectedCommitDiffs([]);

		(async () => {
			try {
				const commits = await invoke<GitCommit[]>('list_git_history', {
					path: selectedRepo.path,
					limit: 75,
				});
				if (requestId !== historyRequestIdReference.current) return;
				setHistoryCommits(commits);
				setSelectedCommitHash(commits[0]?.hash ?? null);
			} catch (error) {
				if (requestId !== historyRequestIdReference.current) return;
				setHistoryError(String(error));
			} finally {
				if (requestId === historyRequestIdReference.current) {
					setIsHistoryLoading(false);
				}
			}
		})();
	}, [isRuntimeAuthorized, selectedRepo]);

	useEffect(() => {
		if (!isRuntimeAuthorized) return;
		if (!selectedRepo || !selectedCommitHash) {
			setSelectedCommitDiffs([]);
			setDiffError(null);
			return;
		}

		diffRequestIdReference.current += 1;
		const requestId = diffRequestIdReference.current;
		setIsDiffLoading(true);
		setDiffError(null);
		setSelectedCommitDiffs([]);

		(async () => {
			try {
				const changes = await invoke<GitCommitFileDiff[]>(
					'get_commit_changes',
					{
						path: selectedRepo.path,
						commit: selectedCommitHash,
					},
				);
				if (requestId !== diffRequestIdReference.current) return;
				setSelectedCommitDiffs(changes);
			} catch (error) {
				if (requestId !== diffRequestIdReference.current) return;
				setDiffError(String(error));
			} finally {
				if (requestId === diffRequestIdReference.current) {
					setIsDiffLoading(false);
				}
			}
		})();
	}, [isRuntimeAuthorized, selectedRepo, selectedCommitHash]);

	// Keyboard shortcuts:
	// - Ctrl+Shift+A (Windows/Linux) or Cmd+Shift+A (macOS): open selected repo in Cursor
	// - Ctrl+Shift+F (Windows/Linux) or Cmd+Shift+F (macOS): show selected repo in Finder/Explorer
	// - Ctrl+Shift+G (Windows/Linux) or Cmd+Shift+G (macOS): open selected repo remote in browser
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (!event.shiftKey) return;

			const isMac = isMacOS();
			const primaryModifierPressed = isMac ? event.metaKey : event.ctrlKey;
			if (!primaryModifierPressed) return;

			const key = event.key.toLowerCase();

			if (key === 'a') {
				event.preventDefault();
				void openSelectedRepoInCursor();
				return;
			}

			if (key === 'f') {
				event.preventDefault();
				void openSelectedRepoInExplorer();
				return;
			}

			if (key === 'g') {
				event.preventDefault();
				if (remoteInfo) {
					void openRemoteInBrowser(remoteInfo);
				}
			}
		}

		globalThis.addEventListener('keydown', handleKeyDown);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
		};
	}, [openSelectedRepoInCursor, openSelectedRepoInExplorer, remoteInfo]);

	useEffect(() => {
		if (!isRuntimeAuthorized) {
			return () => {};
		}
		const unlistenStdoutPromise = listen<AgentStreamPayload>(
			'repo-agent-stdout',
			event => {
				const payload = event.payload as AgentStreamPayloadWire;
				const agentId = payload.agentId ?? payload.agent_id;
				if (typeof agentId !== 'number') return;
				appendAgentLog(agentId, payload.line);
				const streamRecord = parseAgentStreamRecord(payload.line);
				if (streamRecord?.type === 'thinking') {
					if (streamRecord.subtype === 'delta') {
						appendThinkingDelta(agentId, streamRecord.text ?? '');
					} else if (streamRecord.subtype === 'completed') {
						finalizeThinkingMessage(agentId);
					}
					return;
				}
				const systemInit = parseSystemInitRecord(payload.line);
				if (systemInit) {
					if (systemInit.model) {
						setAgentModelById(previous => ({
							...previous,
							[agentId]: systemInit.model,
						}));
					}
					return;
				}
				const editToolCall = parseEditToolCallLifecycle(payload.line);
				if (editToolCall?.event === 'started') {
					pendingEditedPathByAgentReference.current[agentId] =
						editToolCall.path;
					return;
				}
				if (editToolCall?.event === 'completed') {
					const editedPath =
						editToolCall.path ??
						pendingEditedPathByAgentReference.current[agentId] ??
						null;
					delete pendingEditedPathByAgentReference.current[agentId];
					if (editedPath) {
						appendAgentMessage(agentId, {
							role: 'tool',
							text: `Edited: ${editedPath}`,
						});
						return;
					}
				}
				finalizeThinkingMessage(agentId);
				const parsed = parseAgentConversationLine(payload.line);
				if (parsed) appendAgentMessage(agentId, parsed);
			},
		);

		const unlistenStderrPromise = listen<AgentStreamPayload>(
			'repo-agent-stderr',
			event => {
				const payload = event.payload as AgentStreamPayloadWire;
				const agentId = payload.agentId ?? payload.agent_id;
				if (typeof agentId !== 'number') return;
				appendAgentLog(agentId, `stderr: ${payload.line}`);
				finalizeThinkingMessage(agentId);
				appendAgentMessage(agentId, {
					role: 'error',
					text: payload.line,
				});
			},
		);

		const unlistenDonePromise = listen<AgentDonePayload>(
			'repo-agent-done',
			event => {
				const payload = event.payload as AgentDonePayloadWire;
				const agentId = payload.agentId ?? payload.agent_id;
				if (typeof agentId !== 'number') return;
				finalizeThinkingMessage(agentId, true);
				appendAgentMessage(agentId, {
					role: payload.success ? 'system' : 'error',
					text: payload.success
						? 'Agent run completed.'
						: 'Agent run stopped or failed.',
				});
				delete pendingEditedPathByAgentReference.current[agentId];
				setRunningAgentIds(previous => previous.filter(id => id !== agentId));
			},
		);

		return () => {
			void unlistenStdoutPromise.then(unlisten => {
				unlisten();
			});
			void unlistenStderrPromise.then(unlisten => {
				unlisten();
			});
			void unlistenDonePromise.then(unlisten => {
				unlisten();
			});
		};
	}, [
		isRuntimeAuthorized,
		appendAgentLog,
		appendAgentMessage,
		appendThinkingDelta,
		finalizeThinkingMessage,
	]);

	const createAgent = useCallback(
		async (repoId: number, name: string) => {
			setIsCreatingAgentRepoId(repoId);
			try {
				const createdAgent = await invoke<Agent>('create_agent', {
					repoId,
					name,
				});
				setAgentsByRepoId(previous => ({
					...previous,
					[repoId]: [createdAgent, ...(previous[repoId] ?? [])],
				}));
				setSelectedRepo(previous =>
					previous?.id === repoId
						? previous
						: (repos.find(repo => repo.id === repoId) ?? previous),
				);
				setSelectedAgentId(createdAgent.id);
				setActiveRepoViewTab('agent');
				toast.success(`Created agent "${createdAgent.name}"`);
			} catch (error) {
				toast.error(String(error));
			} finally {
				setIsCreatingAgentRepoId(null);
			}
		},
		[repos],
	);

	const runPromptOnAgent = useCallback(async () => {
		if (!selectedRepo || !selectedAgentId) return;
		const trimmedPrompt = agentPrompt.trim();
		if (!trimmedPrompt) return;
		if (runningAgentIds.includes(selectedAgentId)) {
			toast.error('This agent is already running.');
			return;
		}

		const runId = randomRunId();
		delete thinkingMessageIdByAgentReference.current[selectedAgentId];
		setRunningAgentIds(previous =>
			previous.includes(selectedAgentId)
				? previous
				: [...previous, selectedAgentId],
		);
		appendAgentMessage(selectedAgentId, {
			role: 'user',
			text: trimmedPrompt,
		});
		setAgentPrompt('');
		try {
			await invoke('run_repo_agent', {
				repoPath: selectedRepo.path,
				prompt: trimmedPrompt,
				agentId: selectedAgentId,
				runId,
				forceApprove: true,
				simulateMode: isSimulatorMode,
			});
		} catch (error) {
			finalizeThinkingMessage(selectedAgentId, true);
			appendAgentMessage(selectedAgentId, {
				role: 'error',
				text: String(error),
			});
			setRunningAgentIds(previous =>
				previous.filter(id => id !== selectedAgentId),
			);
		}
	}, [
		selectedRepo,
		selectedAgentId,
		agentPrompt,
		isSimulatorMode,
		runningAgentIds,
		appendAgentMessage,
		finalizeThinkingMessage,
	]);

	const deleteAgent = useCallback(
		async (agent: Agent) => {
			setIsDeletingAgentId(agent.id);
			try {
				await invoke('delete_agent', {agentId: agent.id});
				setAgentsByRepoId(previous => ({
					...previous,
					[agent.repo_id]: (previous[agent.repo_id] ?? []).filter(
						existing => existing.id !== agent.id,
					),
				}));
				setSelectedAgentId(previous => {
					if (previous !== agent.id) return previous;
					const nextSelectedAgent = (agentsByRepoId[agent.repo_id] ?? []).find(
						existing => existing.id !== agent.id,
					);
					return nextSelectedAgent?.id ?? null;
				});
				setAgentMessagesById(previous => {
					const next = {...previous};
					delete next[agent.id];
					return next;
				});
				setAgentLogsById(previous => {
					const next = {...previous};
					delete next[agent.id];
					return next;
				});
				setRunningAgentIds(previous => previous.filter(id => id !== agent.id));
				setAgentModelById(previous => {
					const next = {...previous};
					delete next[agent.id];
					return next;
				});
				delete thinkingMessageIdByAgentReference.current[agent.id];
				delete pendingEditedPathByAgentReference.current[agent.id];
				toast.success(`Deleted agent "${agent.name}"`);
			} catch (error) {
				toast.error(String(error));
			} finally {
				setIsDeletingAgentId(null);
			}
		},
		[agentsByRepoId],
	);

	const renameAgent = useCallback(async (agent: Agent, name: string) => {
		const trimmedName = name.trim();
		if (!trimmedName) return;

		setIsRenamingAgentId(agent.id);
		try {
			await invoke('rename_agent', {agentId: agent.id, name: trimmedName});
			setAgentsByRepoId(previous => ({
				...previous,
				[agent.repo_id]: (previous[agent.repo_id] ?? []).map(existing =>
					existing.id === agent.id
						? {...existing, name: trimmedName}
						: existing,
				),
			}));
			toast.success(`Renamed agent to "${trimmedName}"`);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsRenamingAgentId(null);
		}
	}, []);

	const stopAgentRun = useCallback(async () => {
		if (!selectedAgentId) return;
		try {
			await invoke('stop_repo_agent', {agentId: selectedAgentId});
		} catch (error) {
			toast.error(String(error));
		}
	}, [selectedAgentId]);

	async function handleHostLoginSubmit(event: FormEvent) {
		event.preventDefault();
		setHostAuthState('checking');
		const authenticated = await authenticateHostToken(hostAuthTokenInput);
		if (!authenticated) {
			setHostAuthState('unauthorized');
		}
	}

	const selectedRepoAgents = selectedRepo
		? (agentsByRepoId[selectedRepo.id] ?? [])
		: [];
	const selectedAgent =
		selectedRepoAgents.find(agent => agent.id === selectedAgentId) ?? null;
	const selectedAgentIsRunning = selectedAgentId
		? runningAgentIds.includes(selectedAgentId)
		: false;
	const selectedAgentMessages = selectedAgentId
		? (agentMessagesById[selectedAgentId] ?? [])
		: [];
	const selectedAgentLogs = selectedAgentId
		? (agentLogsById[selectedAgentId] ?? [])
		: [];
	const selectedAgentModel = selectedAgentId
		? (agentModelById[selectedAgentId] ?? null)
		: null;

	if (!isRuntimeAuthorized) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-sm">
					<h1 className="text-lg font-semibold">Symphony Access</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Enter the host access token to open Symphony.
					</p>
					<form className="mt-4 space-y-3" onSubmit={handleHostLoginSubmit}>
						<Input
							type="password"
							placeholder="Host access token"
							value={hostAuthTokenInput}
							onChange={event => setHostAuthTokenInput(event.target.value)}
							disabled={hostAuthState === 'checking'}
							autoFocus
						/>
						{hostAuthError && (
							<p className="text-xs text-destructive">{hostAuthError}</p>
						)}
						<Button
							type="submit"
							className="w-full"
							disabled={
								hostAuthState === 'checking' || !hostAuthTokenInput.trim()
							}
						>
							{hostAuthState === 'checking' ? 'Verifying...' : 'Unlock'}
						</Button>
					</form>
				</div>
			</div>
		);
	}

	return (
		<SidebarProvider>
			<RepoSidebar
				repos={repos}
				groups={groups}
				repoSyncStatusById={repoSyncStatusById}
				repoBranchById={repoBranchById}
				agentsByRepoId={agentsByRepoId}
				agentsLoadingByRepoId={agentsLoadingByRepoId}
				agentsErrorByRepoId={agentsErrorByRepoId}
				isCheckingRepoUpdates={isCheckingRepoUpdates}
				selectedRepoId={selectedRepo?.id ?? null}
				selectedAgentId={activeView === 'settings' ? null : selectedAgentId}
				runningAgentIds={runningAgentIds}
				onRepoSelect={repo => {
					setSelectedRepo(repo);
					setActiveView('repo');
				}}
				onAgentSelect={(repo, agentId) => {
					setSelectedRepo(repo);
					setSelectedAgentId(agentId);
					setActiveRepoViewTab('agent');
					setActiveView('repo');
				}}
				onCreateAgent={createAgent}
				onDeleteAgent={deleteAgent}
				onRenameAgent={renameAgent}
				isCreatingAgentRepoId={isCreatingAgentRepoId}
				isDeletingAgentId={isDeletingAgentId}
				isRenamingAgentId={isRenamingAgentId}
				onReposChange={loadRepos}
				onGroupsChange={loadGroups}
				onCheckRepoUpdates={() => void checkRepoUpdates(true)}
				onPullRepo={pullRepo}
				isSettingsActive={activeView === 'settings'}
				onSettingsClick={() => setActiveView('settings')}
				isSimulatorMode={isSimulatorMode}
				hostLanAccessEnabled={hostLanAccessEnabled}
				lanListenUrl={lanListenUrl}
				isHostLanAccessLoading={isHostLanAccessLoading}
				onHostLanAccessChange={enabled => void updateHostLanAccess(enabled)}
			/>
			<SidebarInset>
				<div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:hidden">
					<SidebarTrigger className="size-8" />
					<p className="truncate text-sm font-medium">
						{activeView === 'settings'
							? 'Settings'
							: (selectedRepo?.name ?? 'Repositories')}
					</p>
				</div>
				{activeView === 'settings' ? (
					<SettingsView
						version={appVersion}
						isVersionLoading={isVersionLoading}
						versionError={versionError}
						hostLanAccessEnabled={hostLanAccessEnabled}
						isHostLanAccessLoading={isHostLanAccessLoading}
						onHostLanAccessChange={enabled => void updateHostLanAccess(enabled)}
						simulatorMode={isSimulatorMode}
						onSimulatorModeChange={setIsSimulatorMode}
						rawLogs={showRawLogs}
						onRawLogsChange={setShowRawLogs}
					/>
				) : repos.length === 0 ? (
					<EmptyState onReposChange={loadRepos} />
				) : selectedRepo ? (
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="flex items-center justify-between border-b px-4 py-3">
							<div className="min-w-0">
								<h2 className="truncate text-lg font-semibold">
									{selectedRepo.name}
								</h2>
								<p className="truncate text-sm text-muted-foreground">
									{selectedRepo.path}
								</p>
								{selectedRepoBranch && (
									<p className="mt-1 inline-flex items-center gap-1 truncate text-sm text-muted-foreground">
										<GitBranch className="size-3.5 shrink-0" />
										<span className="truncate">{selectedRepoBranch}</span>
									</p>
								)}
							</div>
							<div className="flex items-center gap-2 flex-wrap">
								<Button
									variant="outline"
									size="sm"
									onClick={() => void openSelectedRepoInExplorer()}
									title={`${SHORTCUT_MODIFIER_LABEL}+Shift+F`}
								>
									<FolderOpen className="size-4" />
									Show in Explorer
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => void openSelectedRepoInCursor()}
									title={`${SHORTCUT_MODIFIER_LABEL}+Shift+A`}
								>
									<SquareTerminal className="size-4" />
									Open in Cursor
								</Button>
								{remoteInfo && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => openRemoteInBrowser(remoteInfo)}
										title={`${SHORTCUT_MODIFIER_LABEL}+Shift+G`}
									>
										<ExternalLink className="size-4" />
										{remoteInfo.provider === 'github'
											? 'Open on GitHub'
											: 'Open on GitLab'}
									</Button>
								)}
							</div>
						</div>
						<div className="border-b px-4">
							<div className="flex items-center gap-2 py-2">
								<Button
									variant={
										activeRepoViewTab === 'agent' ? 'secondary' : 'ghost'
									}
									size="sm"
									onClick={() => {
										setActiveRepoViewTab('agent');
									}}
								>
									Agent
								</Button>
								<Button
									variant={
										activeRepoViewTab === 'changed-files'
											? 'secondary'
											: 'ghost'
									}
									size="sm"
									onClick={() => {
										setActiveRepoViewTab('changed-files');
									}}
								>
									Changes
								</Button>
								<Button
									variant={
										activeRepoViewTab === 'commit-log' ? 'secondary' : 'ghost'
									}
									size="sm"
									onClick={() => {
										setActiveRepoViewTab('commit-log');
									}}
								>
									Commits
								</Button>
							</div>
						</div>
						{activeRepoViewTab === 'agent' ? (
							<RepoAgentsView
								selectedAgent={selectedAgent}
								model={selectedAgentModel}
								prompt={agentPrompt}
								messages={selectedAgentMessages}
								logs={selectedAgentLogs}
								isRunning={selectedAgentIsRunning}
								showRawLogs={showRawLogs}
								onPromptChange={setAgentPrompt}
								onRunPrompt={() => void runPromptOnAgent()}
								onStopRun={() => void stopAgentRun()}
							/>
						) : activeRepoViewTab === 'changed-files' ? (
							<ChangedFilesView
								repo={selectedRepo}
								isActive={activeRepoViewTab === 'changed-files'}
								onCommitted={() => {
									void checkRepoUpdates(true);
									setSelectedRepo(previous =>
										previous ? {...previous, path: previous.path} : previous,
									);
								}}
							/>
						) : (
							<GitHistoryView
								repo={selectedRepo}
								commits={historyCommits}
								selectedCommitHash={selectedCommitHash}
								onSelectCommit={setSelectedCommitHash}
								isHistoryLoading={isHistoryLoading}
								historyError={historyError}
								fileDiffs={selectedCommitDiffs}
								isDiffLoading={isDiffLoading}
								diffError={diffError}
							/>
						)}
					</div>
				) : (
					<div className="flex flex-1 items-center justify-center">
						<p className="text-sm text-muted-foreground">
							Select a repository from the sidebar
						</p>
					</div>
				)}
			</SidebarInset>
			<Toaster />
		</SidebarProvider>
	);
}

export default App;
