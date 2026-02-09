/* eslint-disable unicorn/no-null */
import {EmptyState} from '@/components/empty-state';
import {GitHistoryView} from '@/components/git-history-view';
import {RepoAgentsView} from '@/components/repo-agents-view';
import {RepoSidebar} from '@/components/repo-sidebar';
import {Button} from '@/components/ui/button';
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar';
import {Toaster} from '@/components/ui/sonner';
import type {
	Agent,
	GitCommit,
	GitCommitFileDiff,
	Group,
	Repo,
	RepoSyncStatus,
} from '@/lib/types';
import {invoke} from '@tauri-apps/api/core';
import {openPath, openUrl} from '@tauri-apps/plugin-opener';
import {ExternalLink, FolderOpen, SquareTerminal} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

type RemoteInfo = {
	provider: 'github' | 'gitlab';
	url: string;
};

type RepoViewTab = 'agent' | 'commit-log';

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
	const [activeRepoViewTab, setActiveRepoViewTab] = useState<RepoViewTab>('agent');
	const [agents, setAgents] = useState<Agent[]>([]);
	const [isAgentsLoading, setIsAgentsLoading] = useState(false);
	const [agentsError, setAgentsError] = useState<string | null>(null);
	const [isCreatingAgent, setIsCreatingAgent] = useState(false);
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
	const [isCheckingRepoUpdates, setIsCheckingRepoUpdates] = useState(false);
	const historyRequestIdReference = useRef(0);
	const diffRequestIdReference = useRef(0);

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

	useEffect(() => {
		loadRepos();
		loadGroups();
	}, [loadRepos, loadGroups]);

	useEffect(() => {
		void checkRepoUpdates(false);
	}, [checkRepoUpdates]);

	// Fetch remote info whenever selectedRepo changes
	useEffect(() => {
		if (!selectedRepo) {
			setRemoteInfo(null);
			setActiveRepoViewTab('agent');
			return;
		}

		(async () => {
			try {
				const info = await invoke<RemoteInfo | null>('get_remote_url', {
					path: selectedRepo.path,
				});
				setRemoteInfo(info);
			} catch {
				setRemoteInfo(null);
			}
		})();
	}, [selectedRepo]);

	useEffect(() => {
		if (!selectedRepo) {
			setAgents([]);
			setAgentsError(null);
			return;
		}

		setIsAgentsLoading(true);
		setAgentsError(null);
		setAgents([]);

		(async () => {
			try {
				const result = await invoke<Agent[]>('list_agents', {
					repoId: selectedRepo.id,
				});
				setAgents(result);
			} catch (error) {
				setAgentsError(String(error));
			} finally {
				setIsAgentsLoading(false);
			}
		})();
	}, [selectedRepo]);

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
	// - Ctrl+Shift+A: open selected repo in Cursor
	// - Ctrl+Shift+F: show selected repo in Finder/Explorer
	// - Ctrl+Shift+G: open selected repo remote in browser
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (!event.ctrlKey || !event.shiftKey) return;
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

	const createAgent = useCallback(
		async (name: string) => {
			if (!selectedRepo) return;
			setIsCreatingAgent(true);
			try {
				const createdAgent = await invoke<Agent>('create_agent', {
					repoId: selectedRepo.id,
					name,
				});
				setAgents(previous => [createdAgent, ...previous]);
				toast.success(`Created agent "${createdAgent.name}"`);
			} catch (error) {
				toast.error(String(error));
			} finally {
				setIsCreatingAgent(false);
			}
		},
		[selectedRepo],
	);

	return (
		<SidebarProvider>
			<RepoSidebar
				repos={repos}
				groups={groups}
				repoSyncStatusById={repoSyncStatusById}
				isCheckingRepoUpdates={isCheckingRepoUpdates}
				selectedRepoId={selectedRepo?.id ?? null}
				onRepoSelect={setSelectedRepo}
				onReposChange={loadRepos}
				onGroupsChange={loadGroups}
				onCheckRepoUpdates={() => void checkRepoUpdates(true)}
				onPullRepo={pullRepo}
			/>
			<SidebarInset>
				{repos.length === 0 ? (
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
							</div>
							<div className="flex items-center gap-2 flex-wrap">
								<Button
									variant="outline"
									size="sm"
									onClick={() => void openSelectedRepoInExplorer()}
									title="Ctrl+Shift+F"
								>
									<FolderOpen className="size-4" />
									Show in Explorer
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => void openSelectedRepoInCursor()}
									title="Ctrl+Shift+A"
								>
									<SquareTerminal className="size-4" />
									Open in Cursor
								</Button>
								{remoteInfo && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => openRemoteInBrowser(remoteInfo)}
										title="Ctrl+Shift+G"
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
								agents={agents}
								isLoading={isAgentsLoading}
								error={agentsError}
								isCreating={isCreatingAgent}
								onCreateAgent={createAgent}
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
