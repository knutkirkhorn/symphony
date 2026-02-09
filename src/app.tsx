/* eslint-disable unicorn/no-null */
import {EmptyState} from '@/components/empty-state';
import {RepoSidebar} from '@/components/repo-sidebar';
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar';
import {Toaster} from '@/components/ui/sonner';
import type {Repo} from '@/lib/types';
import {invoke} from '@tauri-apps/api/core';
import {useCallback, useEffect, useState} from 'react';

function App() {
	const [repos, setRepos] = useState<Repo[]>([]);
	const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);

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
						<div className="text-center space-y-2">
							<h2 className="text-lg font-semibold">{selectedRepo.name}</h2>
							<p className="text-sm text-muted-foreground">
								{selectedRepo.path}
							</p>
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
