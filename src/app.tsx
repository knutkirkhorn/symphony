/* eslint-disable unicorn/no-null */
import {EmptyState} from '@/components/empty-state';
import {GitHistoryView} from '@/components/git-history-view';
import {RepoAgentsView} from '@/components/repo-agents-view';
import {RepoSidebar} from '@/components/repo-sidebar';
import {SettingsView} from '@/components/settings-view';
import {Button} from '@/components/ui/button';
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar';
import {Toaster} from '@/components/ui/sonner';
import type {
	Agent,
	AgentConversationEntry,
	GitCommit,
	GitCommitFileDiff,
	Group,
	Repo,
	RepoSyncStatus,
} from '@/lib/types';
import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {openPath, openUrl} from '@tauri-apps/plugin-opener';
import {
	ExternalLink,
	FolderOpen,
	GitBranch,
	SquareTerminal,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

type RemoteInfo = {
	provider: 'github' | 'gitlab';
	url: string;
};

type RepoViewTab = 'agent' | 'commit-log';
type AppView = 'repo' | 'settings';

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

function isMacOS() {
	if (typeof navigator === 'undefined') return false;
	const platform = navigator.platform.toUpperCase();
	return platform.includes('MAC') || /Mac/.test(navigator.userAgent);
}

const SHORTCUT_MODIFIER_LABEL = isMacOS() ? 'Cmd' : 'Ctrl';

function randomRunId() {
	if ('randomUUID' in crypto) return crypto.randomUUID();
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

		if (record.type === 'tool_call' && record.subtype === 'started') {
			const command = record.tool_call?.shellToolCall?.args?.command;
			const path = record.tool_call?.editToolCall?.args?.path;
			if (command) return {role: 'tool', text: `Running: ${command}`};
			if (path) return {role: 'tool', text: `Editing: ${path}`};
			return {role: 'tool', text: 'Tool call started'};
		}

		if (record.type === 'tool_call' && record.subtype === 'completed') {
			return {role: 'tool', text: 'Tool call completed'};
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
	const [isAgentRunning, setIsAgentRunning] = useState(false);
	const [agentMessagesById, setAgentMessagesById] = useState<
		Record<number, AgentConversationEntry[]>
	>({});
	const [agentLogsById, setAgentLogsById] = useState<Record<number, string[]>>(
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
	const activeRunIdReference = useRef<string | null>(null);
	const activeRunAgentIdReference = useRef<number | null>(null);

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
	}, []);

	const loadGroups = useCallback(async () => {
		try {
			const result = await invoke<Group[]>('list_groups');
			setGroups(result);
		} catch (error) {
			console.error('Failed to load groups:', error);
		}
	}, []);

	const checkRepoUpdates = useCallback(
		async (fetch: boolean) => {
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
		[repos],
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

	useEffect(() => {
		loadRepos();
		loadGroups();
	}, [loadRepos, loadGroups]);

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
		void checkRepoUpdates(false);
	}, [checkRepoUpdates]);

	// Fetch remote info whenever selectedRepo changes
	useEffect(() => {
		if (!selectedRepo) {
			setRemoteInfo(null);
			setSelectedRepoBranch(null);
			setActiveRepoViewTab('agent');
			setSelectedAgentId(null);
			setAgentPrompt('');
			setIsAgentRunning(false);
			setAgentMessagesById({});
			setAgentLogsById({});
			activeRunIdReference.current = null;
			activeRunAgentIdReference.current = null;
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
	}, [selectedRepo]);

	useEffect(() => {
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
	}, [repos]);

	useEffect(() => {
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
	}, [repos]);

	useEffect(() => {
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
	}, [selectedRepo]);

	useEffect(() => {
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
	}, [selectedRepo, selectedCommitHash]);

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
		const unlistenStdoutPromise = listen<AgentStreamPayload>(
			'repo-agent-stdout',
			event => {
				const activeRunId = activeRunIdReference.current;
				const activeAgentId = activeRunAgentIdReference.current;
				if (!activeRunId || !activeAgentId) return;
				if (
					event.payload.runId !== activeRunId ||
					event.payload.agentId !== activeAgentId
				) {
					return;
				}

				appendAgentLog(activeAgentId, event.payload.line);
				const parsed = parseAgentConversationLine(event.payload.line);
				if (parsed) appendAgentMessage(activeAgentId, parsed);
			},
		);

		const unlistenStderrPromise = listen<AgentStreamPayload>(
			'repo-agent-stderr',
			event => {
				const activeRunId = activeRunIdReference.current;
				const activeAgentId = activeRunAgentIdReference.current;
				if (!activeRunId || !activeAgentId) return;
				if (
					event.payload.runId !== activeRunId ||
					event.payload.agentId !== activeAgentId
				) {
					return;
				}

				appendAgentLog(activeAgentId, `stderr: ${event.payload.line}`);
				appendAgentMessage(activeAgentId, {
					role: 'error',
					text: event.payload.line,
				});
			},
		);

		const unlistenDonePromise = listen<AgentDonePayload>(
			'repo-agent-done',
			event => {
				const activeRunId = activeRunIdReference.current;
				const activeAgentId = activeRunAgentIdReference.current;
				if (!activeRunId || !activeAgentId) return;
				if (
					event.payload.runId !== activeRunId ||
					event.payload.agentId !== activeAgentId
				) {
					return;
				}

				appendAgentMessage(activeAgentId, {
					role: event.payload.success ? 'system' : 'error',
					text: event.payload.success
						? 'Agent run completed.'
						: 'Agent run stopped or failed.',
				});
				setIsAgentRunning(false);
				activeRunIdReference.current = null;
				activeRunAgentIdReference.current = null;
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
	}, [appendAgentLog, appendAgentMessage]);

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
		if (!trimmedPrompt || isAgentRunning) return;

		const runId = randomRunId();
		activeRunIdReference.current = runId;
		activeRunAgentIdReference.current = selectedAgentId;
		setIsAgentRunning(true);

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
			});
		} catch (error) {
			appendAgentMessage(selectedAgentId, {
				role: 'error',
				text: String(error),
			});
			setIsAgentRunning(false);
			activeRunIdReference.current = null;
			activeRunAgentIdReference.current = null;
		}
	}, [
		selectedRepo,
		selectedAgentId,
		agentPrompt,
		isAgentRunning,
		appendAgentMessage,
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
				if (activeRunAgentIdReference.current === agent.id) {
					setIsAgentRunning(false);
					activeRunIdReference.current = null;
					activeRunAgentIdReference.current = null;
				}
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
		try {
			await invoke('stop_repo_agent');
			setIsAgentRunning(false);
			activeRunIdReference.current = null;
			activeRunAgentIdReference.current = null;
		} catch (error) {
			toast.error(String(error));
		}
	}, []);

	const selectedRepoAgents = selectedRepo
		? (agentsByRepoId[selectedRepo.id] ?? [])
		: [];
	const selectedAgent =
		selectedRepoAgents.find(agent => agent.id === selectedAgentId) ?? null;
	const selectedAgentMessages = selectedAgentId
		? (agentMessagesById[selectedAgentId] ?? [])
		: [];
	const selectedAgentLogs = selectedAgentId
		? (agentLogsById[selectedAgentId] ?? [])
		: [];

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
				selectedAgentId={selectedAgentId}
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
			/>
			<SidebarInset>
				{activeView === 'settings' ? (
					<SettingsView
						version={appVersion}
						isVersionLoading={isVersionLoading}
						versionError={versionError}
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
										activeRepoViewTab === 'commit-log' ? 'secondary' : 'ghost'
									}
									size="sm"
									onClick={() => {
										setActiveRepoViewTab('commit-log');
									}}
								>
									Commit Log
								</Button>
							</div>
						</div>
						{activeRepoViewTab === 'agent' ? (
							<RepoAgentsView
								selectedAgent={selectedAgent}
								prompt={agentPrompt}
								messages={selectedAgentMessages}
								logs={selectedAgentLogs}
								isRunning={isAgentRunning}
								onPromptChange={setAgentPrompt}
								onRunPrompt={() => void runPromptOnAgent()}
								onStopRun={() => void stopAgentRun()}
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
