/* eslint-disable unicorn/no-null */
import {EmptyState} from '@/components/empty-state';
import {RepoSidebar} from '@/components/repo-sidebar';
import {Button} from '@/components/ui/button';
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar';
import {Toaster} from '@/components/ui/sonner';
import type {Repo} from '@/lib/types';
import {invoke} from '@tauri-apps/api/core';
import {openUrl, openPath} from '@tauri-apps/plugin-opener';
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
	const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
	const [remoteInfo, setRemoteInfo] = useState<RemoteInfo | null>(null);

	const loadRepos = useCallback(async () => {
		try {
			const result = await invoke<Repo[]>('list_repos');
			setRepos(result);
		} catch (error) {
			console.error('Failed to load repos:', error);
		}
	}, []);

	useEffect(() => {
		loadRepos();
	}, [loadRepos]);

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

	// Keyboard shortcut: Ctrl+Shift+G to open remote in browser
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.ctrlKey && event.shiftKey && event.key === 'G') {
				event.preventDefault();
				if (remoteInfo) {
					openRemoteInBrowser(remoteInfo);
				}
			}
		}

		globalThis.addEventListener('keydown', handleKeyDown);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
		};
	}, [remoteInfo]);

	return (
		<SidebarProvider>
			<RepoSidebar
				repos={repos}
				selectedRepoId={selectedRepo?.id ?? null}
				onRepoSelect={setSelectedRepo}
				onReposChange={loadRepos}
			/>
			<SidebarInset>
				{repos.length === 0 ? (
					<EmptyState onReposChange={loadRepos} />
				) : selectedRepo ? (
					<div className="flex flex-1 items-center justify-center p-6">
						<div className="text-center space-y-4">
							<div className="space-y-2">
								<h2 className="text-lg font-semibold">
									{selectedRepo.name}
								</h2>
								<p className="text-sm text-muted-foreground">
									{selectedRepo.path}
								</p>
							</div>
							<div className="flex items-center justify-center gap-2 flex-wrap">
								<Button
									variant="outline"
									size="sm"
									onClick={async () => {
										try {
											await openPath(selectedRepo.path);
										} catch (error) {
											toast.error(String(error));
										}
									}}
								>
									<FolderOpen className="size-4" />
									Show in Explorer
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={async () => {
										try {
											await invoke('open_in_cursor', {
												path: selectedRepo.path,
											});
										} catch (error) {
											toast.error(String(error));
										}
									}}
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
