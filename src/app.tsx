/* eslint-disable unicorn/no-null */
import {EmptyState} from '@/components/empty-state';
import {RepoSidebar} from '@/components/repo-sidebar';
import {Button} from '@/components/ui/button';
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar';
import {Toaster} from '@/components/ui/sonner';
import type {Group, Repo} from '@/lib/types';
import {invoke} from '@tauri-apps/api/core';
import {openPath, openUrl} from '@tauri-apps/plugin-opener';
import {ExternalLink, FolderOpen, SquareTerminal} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';

type RemoteInfo = {
	provider: 'github' | 'gitlab';
	url: string;
};

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

	useEffect(() => {
		loadRepos();
		loadGroups();
	}, [loadRepos, loadGroups]);

	// Fetch remote info whenever selectedRepo changes
	useEffect(() => {
		if (!selectedRepo) {
			setRemoteInfo(null);
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

	return (
		<SidebarProvider>
			<RepoSidebar
				repos={repos}
				groups={groups}
				selectedRepoId={selectedRepo?.id ?? null}
				onRepoSelect={setSelectedRepo}
				onReposChange={loadRepos}
				onGroupsChange={loadGroups}
			/>
			<SidebarInset>
				{repos.length === 0 ? (
					<EmptyState onReposChange={loadRepos} />
				) : selectedRepo ? (
					<div className="flex flex-1 items-center justify-center p-6">
						<div className="text-center space-y-4">
							<div className="space-y-2">
								<h2 className="text-lg font-semibold">{selectedRepo.name}</h2>
								<p className="text-sm text-muted-foreground">
									{selectedRepo.path}
								</p>
							</div>
							<div className="flex items-center justify-center gap-2 flex-wrap">
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
