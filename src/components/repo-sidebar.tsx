import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import type {Repo} from '@/lib/types';
import {invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {FolderGit2, Plus, Trash2} from 'lucide-react';
import {toast} from 'sonner';

type RepoSidebarProperties = {
	repos: Repo[];
	selectedRepoId: number | null;
	onRepoSelect: (repo: Repo) => void;
	onReposChange: () => void;
};

async function handleAddRepo(onReposChange: () => void) {
	const selected = await open({
		directory: true,
		multiple: false,
		title: 'Select a Git repository',
	});

	if (!selected) {
		return;
	}

	try {
		await invoke('add_repo', {path: selected});
		toast.success('Repository added successfully');
		onReposChange();
	} catch (error) {
		toast.error(String(error));
	}
}

async function handleRemoveRepo(id: number, onReposChange: () => void) {
	try {
		await invoke('remove_repo', {id});
		toast.success('Repository removed');
		onReposChange();
	} catch (error) {
		toast.error(String(error));
	}
}

export function RepoSidebar({
	repos,
	selectedRepoId,
	onRepoSelect,
	onReposChange,
}: RepoSidebarProperties) {
	return (
		<Sidebar>
			<SidebarHeader className="border-b border-sidebar-border">
				<div className="flex items-center justify-between">
					<span className="text-sm font-semibold">Repositories</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={() => handleAddRepo(onReposChange)}
							>
								<Plus className="size-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">Add repository</TooltipContent>
					</Tooltip>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<ScrollArea className="flex-1">
					<SidebarGroup>
						<SidebarGroupLabel>Repos</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{repos.map(repo => (
									<SidebarMenuItem key={repo.id}>
										<SidebarMenuButton
											isActive={repo.id === selectedRepoId}
											onClick={() => onRepoSelect(repo)}
											tooltip={repo.path}
										>
											<FolderGit2 className="size-4" />
											<span>{repo.name}</span>
										</SidebarMenuButton>
										<SidebarMenuAction
											showOnHover
											onClick={event => {
												event.stopPropagation();
												handleRemoveRepo(repo.id, onReposChange);
											}}
										>
											<Trash2 className="size-3.5" />
										</SidebarMenuAction>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</ScrollArea>
			</SidebarContent>
		</Sidebar>
	);
}
