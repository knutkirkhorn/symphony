/* eslint-disable unicorn/no-null */
import {AddRepoDialog} from '@/components/add-repo-dialog';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
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
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import type {Agent, Group, Repo, RepoSyncStatus} from '@/lib/types';
import {cn} from '@/lib/utils';
import {invoke} from '@tauri-apps/api/core';
import {
	ArrowRightLeft,
	Bot,
	Check,
	ChevronRight,
	Download,
	FolderGit2,
	FolderPlus,
	GitBranch,
	LoaderCircle,
	MoreHorizontal,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {toast} from 'sonner';

type RepoSidebarProperties = {
	repos: Repo[];
	groups: Group[];
	repoSyncStatusById: Record<number, RepoSyncStatus>;
	repoBranchById: Record<number, string>;
	agentsByRepoId: Record<number, Agent[]>;
	agentsLoadingByRepoId: Record<number, boolean>;
	agentsErrorByRepoId: Record<number, string | null>;
	isCheckingRepoUpdates: boolean;
	selectedRepoId: number | null;
	selectedAgentId: number | null;
	onRepoSelect: (repo: Repo) => void;
	onAgentSelect: (repo: Repo, agentId: number) => void;
	onCreateAgent: (repoId: number, name: string) => Promise<void>;
	onDeleteAgent: (agent: Agent) => Promise<void>;
	onRenameAgent: (agent: Agent, name: string) => Promise<void>;
	isCreatingAgentRepoId: number | null;
	isDeletingAgentId: number | null;
	isRenamingAgentId: number | null;
	onReposChange: () => void;
	onGroupsChange: () => void;
	onCheckRepoUpdates: () => void;
	onPullRepo: (repo: Repo) => Promise<void>;
};

type LocalBranch = {
	name: string;
	isCurrent: boolean;
};

type RepoWorkingTreeStatus = {
	hasChanges: boolean;
	hasStagedChanges: boolean;
	hasUnstagedChanges: boolean;
	hasUntrackedChanges: boolean;
};

async function handleRemoveRepo(id: number, onReposChange: () => void) {
	try {
		await invoke('remove_repo', {id});
		toast.success('Repository removed');
		onReposChange();
	} catch (error) {
		toast.error(String(error));
	}
}

async function handleMoveToGroup(
	repoId: number,
	groupId: number | null,
	onReposChange: () => void,
) {
	try {
		await invoke('move_repo_to_group', {repoId, groupId});
		onReposChange();
	} catch (error) {
		toast.error(String(error));
	}
}

type DropZone = {type: 'group'; groupId: number} | {type: 'ungrouped'};

function readDropZoneFromElement(target: Element | null): DropZone | null {
	const zoneElement = target?.closest<HTMLElement>('[data-drop-zone]');
	if (!zoneElement) return null;
	const zoneType = zoneElement.dataset.dropZone;
	if (zoneType === 'ungrouped') return {type: 'ungrouped'};
	if (zoneType === 'group') {
		const groupIdRaw = zoneElement.dataset.dropGroupId;
		const groupId = Number(groupIdRaw);
		if (!Number.isInteger(groupId) || groupId <= 0) return null;
		return {type: 'group', groupId};
	}

	return null;
}

function getRepoIdFromDragEvent(event: React.DragEvent) {
	const repoIdData =
		event.dataTransfer.getData('application/x-repo-id') ||
		event.dataTransfer.getData('text/plain');
	const repoId = Number(repoIdData);
	if (!Number.isInteger(repoId) || repoId <= 0) return null;
	return repoId;
}

function handleDropZoneDragOver(event: React.DragEvent) {
	event.preventDefault();
	event.dataTransfer.dropEffect = 'move';
}

// --- Draggable Repo Item with Context Menu ---

function DraggableRepoItem({
	repo,
	syncStatus,
	branch,
	isActive,
	selectedAgentId,
	agents,
	isAgentsLoading,
	agentsError,
	isCreatingAgentRepoId,
	isDeletingAgentId,
	isRenamingAgentId,
	groups,
	onRepoSelect,
	onAgentSelect,
	onCreateAgent,
	onDeleteAgent,
	onRenameAgent,
	onReposChange,
	onPointerDragStart,
	onPullRepo,
	onCheckRepoUpdates,
}: {
	repo: Repo;
	syncStatus?: RepoSyncStatus;
	branch?: string;
	isActive: boolean;
	selectedAgentId: number | null;
	agents: Agent[];
	isAgentsLoading: boolean;
	agentsError: string | null;
	isCreatingAgentRepoId: number | null;
	isDeletingAgentId: number | null;
	isRenamingAgentId: number | null;
	groups: Group[];
	onRepoSelect: (repo: Repo) => void;
	onAgentSelect: (repo: Repo, agentId: number) => void;
	onCreateAgent: (repoId: number, name: string) => Promise<void>;
	onDeleteAgent: (agent: Agent) => Promise<void>;
	onRenameAgent: (agent: Agent, name: string) => Promise<void>;
	onReposChange: () => void;
	onPointerDragStart: (event: React.PointerEvent, repo: Repo) => void;
	onPullRepo: (repo: Repo) => Promise<void>;
	onCheckRepoUpdates: () => void;
}) {
	// Groups the repo can be moved to (exclude the one it's already in)
	const moveTargets = groups.filter(g => g.id !== repo.group_id);
	const canMoveToUngrouped = repo.group_id !== null;
	const [isAgentsOpen, setIsAgentsOpen] = useState(isActive);
	const [isCreatingInlineAgent, setIsCreatingInlineAgent] = useState(false);
	const [isRenameAgentDialogOpen, setIsRenameAgentDialogOpen] = useState(false);
	const [agentToRename, setAgentToRename] = useState<Agent | null>(null);
	const [renameAgentName, setRenameAgentName] = useState('');
	const [newAgentName, setNewAgentName] = useState('');
	const isCreatingThisRepoAgent = isCreatingAgentRepoId === repo.id;
	const hasAgents = agents.length > 0;
	const isRenamingSelectedAgent = Boolean(
		agentToRename && isRenamingAgentId === agentToRename.id,
	);
	const [isBranchDialogOpen, setIsBranchDialogOpen] = useState(false);
	const [localBranches, setLocalBranches] = useState<LocalBranch[]>([]);
	const [selectedBranchName, setSelectedBranchName] = useState<string | null>(
		null,
	);
	const [branchSearchQuery, setBranchSearchQuery] = useState('');
	const [newBranchName, setNewBranchName] = useState('');
	const [deleteForce, setDeleteForce] = useState(false);
	const [moveChangesOnSwitch, setMoveChangesOnSwitch] = useState(true);
	const [workingTreeStatus, setWorkingTreeStatus] =
		useState<RepoWorkingTreeStatus | null>(null);
	const [isBranchDataLoading, setIsBranchDataLoading] = useState(false);
	const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
	const [isCreatingBranch, setIsCreatingBranch] = useState(false);
	const [isDeletingBranch, setIsDeletingBranch] = useState(false);

	const currentBranchName =
		localBranches.find(localBranch => localBranch.isCurrent)?.name ??
		branch ??
		null;
	const canSwitchBranch = Boolean(
		selectedBranchName &&
		currentBranchName &&
		selectedBranchName.trim() !== currentBranchName.trim(),
	);
	const canDeleteBranch = Boolean(
		selectedBranchName &&
		currentBranchName &&
		selectedBranchName.trim() !== currentBranchName.trim(),
	);
	const normalizedBranchSearchQuery = branchSearchQuery.trim().toLowerCase();
	const filteredLocalBranches =
		normalizedBranchSearchQuery.length === 0
			? localBranches
			: localBranches.filter(localBranch =>
					localBranch.name.toLowerCase().includes(normalizedBranchSearchQuery),
				);

	const refreshBranchDialogData = useCallback(async () => {
		setIsBranchDataLoading(true);
		try {
			const [branchesResult, statusResult] = await Promise.all([
				invoke<LocalBranch[]>('list_local_branches', {path: repo.path}),
				invoke<RepoWorkingTreeStatus>('get_repo_working_tree_status', {
					path: repo.path,
				}),
			]);
			setLocalBranches(branchesResult);
			setWorkingTreeStatus(statusResult);
			setSelectedBranchName(previousSelection => {
				if (
					previousSelection &&
					branchesResult.some(
						localBranch => localBranch.name === previousSelection,
					)
				) {
					return previousSelection;
				}
				const firstNonCurrent = branchesResult.find(
					localBranch => !localBranch.isCurrent,
				);
				return firstNonCurrent?.name ?? branchesResult[0]?.name ?? null;
			});
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsBranchDataLoading(false);
		}
	}, [repo.path]);

	async function handleSwitchBranch() {
		if (!selectedBranchName || !canSwitchBranch) return;
		setIsSwitchingBranch(true);
		try {
			const message = await invoke<string>('switch_branch', {
				path: repo.path,
				targetBranch: selectedBranchName,
				moveChanges: moveChangesOnSwitch,
			});
			toast.success(message);
			await refreshBranchDialogData();
			onReposChange();
			onCheckRepoUpdates();
			onRepoSelect({...repo});
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsSwitchingBranch(false);
		}
	}

	async function handleCreateBranch() {
		const trimmed = newBranchName.trim();
		if (!trimmed) return;
		setIsCreatingBranch(true);
		try {
			const message = await invoke<string>('create_local_branch', {
				path: repo.path,
				name: trimmed,
			});
			toast.success(message);
			setNewBranchName('');
			await refreshBranchDialogData();
			setSelectedBranchName(trimmed);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsCreatingBranch(false);
		}
	}

	async function handleDeleteBranch() {
		if (!selectedBranchName || !canDeleteBranch) return;
		setIsDeletingBranch(true);
		try {
			const message = await invoke<string>('delete_local_branch', {
				path: repo.path,
				branchName: selectedBranchName,
				force: deleteForce,
			});
			toast.success(message);
			await refreshBranchDialogData();
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsDeletingBranch(false);
		}
	}

	async function handleCreateAgent() {
		const trimmed = newAgentName.trim();
		if (!trimmed) return;
		await onCreateAgent(repo.id, trimmed);
		setNewAgentName('');
		setIsCreatingInlineAgent(false);
		setIsAgentsOpen(true);
	}

	useEffect(() => {
		if (isActive) setIsAgentsOpen(true);
	}, [isActive]);

	async function handleRenameAgent(event: FormEvent) {
		event.preventDefault();
		if (!agentToRename) return;
		const trimmed = renameAgentName.trim();
		if (!trimmed) return;

		await onRenameAgent(agentToRename, trimmed);
		setIsRenameAgentDialogOpen(false);
		setAgentToRename(null);
		setRenameAgentName('');
	}

	return (
		<SidebarMenuItem className="select-none cursor-grab active:cursor-grabbing">
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<SidebarMenuButton
						isActive={isActive}
						onClick={() => {
							onRepoSelect(repo);
						}}
						onPointerDown={event => onPointerDragStart(event, repo)}
						title={repo.path}
						className={cn(
							'select-none cursor-grab active:cursor-grabbing pr-14',
							isActive &&
								'bg-primary/12 text-foreground font-semibold ring-1 ring-primary/35 shadow-sm [&>svg]:text-primary',
						)}
					>
						<FolderGit2 className="size-4" />
						<span>{repo.name}</span>
						{branch && (
							<span className="ml-1 inline-flex max-w-36 items-center gap-1 text-xs text-muted-foreground">
								<GitBranch className="size-3 shrink-0" />
								<span className="truncate">{branch}</span>
							</span>
						)}
						{syncStatus?.can_pull && (
							<span className="ml-auto mr-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
								{syncStatus.behind} new
							</span>
						)}
					</SidebarMenuButton>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem
						onClick={() => void onPullRepo(repo)}
						disabled={syncStatus ? !syncStatus.has_upstream : false}
					>
						<Download className="size-4" />
						Pull changes
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => {
							setIsBranchDialogOpen(true);
							void refreshBranchDialogData();
						}}
					>
						<GitBranch className="size-4" />
						Change branch
					</ContextMenuItem>
					<ContextMenuSeparator />
					{(moveTargets.length > 0 || canMoveToUngrouped) && (
						<>
							<ContextMenuSub>
								<ContextMenuSubTrigger>
									<ArrowRightLeft className="size-4" />
									Move to...
								</ContextMenuSubTrigger>
								<ContextMenuSubContent>
									{moveTargets.map(group => (
										<ContextMenuItem
											key={group.id}
											onClick={() =>
												handleMoveToGroup(repo.id, group.id, onReposChange)
											}
										>
											{group.name}
										</ContextMenuItem>
									))}
									{canMoveToUngrouped && (
										<>
											{moveTargets.length > 0 && <ContextMenuSeparator />}
											<ContextMenuItem
												onClick={() =>
													handleMoveToGroup(repo.id, null, onReposChange)
												}
											>
												Ungrouped
											</ContextMenuItem>
										</>
									)}
								</ContextMenuSubContent>
							</ContextMenuSub>
							<ContextMenuSeparator />
						</>
					)}
					<ContextMenuItem
						variant="destructive"
						onClick={() => handleRemoveRepo(repo.id, onReposChange)}
					>
						<Trash2 className="size-4" />
						Remove
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<SidebarMenuAction
				onClick={event => {
					event.stopPropagation();
					setIsAgentsOpen(previous => !previous);
				}}
				title={isAgentsOpen ? 'Collapse agents' : 'Expand agents'}
				className={cn(
					'right-8 text-sidebar-foreground/70 hover:text-sidebar-foreground',
					isAgentsOpen && 'text-sidebar-foreground',
				)}
			>
				<ChevronRight
					className={cn(
						'size-3.5 transition-transform',
						isAgentsOpen && 'rotate-90',
					)}
				/>
			</SidebarMenuAction>
			<Collapsible open={isAgentsOpen} onOpenChange={setIsAgentsOpen}>
				<CollapsibleContent>
					<SidebarMenuSub className="mt-1 rounded-md bg-sidebar-accent/20 py-2">
						<SidebarMenuSubItem>
							<div className="flex items-center justify-between px-2">
								<p className="text-[10px] font-semibold tracking-wide text-sidebar-foreground/60 uppercase">
									Agents
								</p>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-5"
									onClick={() =>
										setIsCreatingInlineAgent(previous => !previous)
									}
									title="Create agent"
								>
									<Plus className="size-3.5" />
								</Button>
							</div>
						</SidebarMenuSubItem>
						{isCreatingInlineAgent && (
							<SidebarMenuSubItem>
								<div className="flex items-center gap-1.5 px-2 py-1">
									<Input
										value={newAgentName}
										onChange={event => setNewAgentName(event.target.value)}
										placeholder="Agent name"
										className="h-7 text-xs"
										disabled={isCreatingThisRepoAgent}
										onKeyDown={event => {
											if (event.key === 'Enter') {
												event.preventDefault();
												void handleCreateAgent();
											}
										}}
									/>
									<Button
										type="button"
										size="sm"
										className="h-7 px-2 text-xs"
										disabled={
											isCreatingThisRepoAgent ||
											newAgentName.trim().length === 0
										}
										onClick={() => void handleCreateAgent()}
									>
										{isCreatingThisRepoAgent ? '...' : 'Add'}
									</Button>
								</div>
							</SidebarMenuSubItem>
						)}
						{isAgentsLoading ? (
							<SidebarMenuSubItem>
								<p className="px-2 py-1 text-xs text-sidebar-foreground/60">
									Loading agents...
								</p>
							</SidebarMenuSubItem>
						) : agentsError ? (
							<SidebarMenuSubItem>
								<p className="px-2 py-1 text-xs text-destructive">
									{agentsError}
								</p>
							</SidebarMenuSubItem>
						) : hasAgents ? (
							agents.map(agent => (
								<SidebarMenuSubItem key={agent.id}>
									<ContextMenu>
										<ContextMenuTrigger asChild>
											<div className="group/menu-sub-item relative">
												<SidebarMenuSubButton
													asChild
													size="sm"
													isActive={selectedAgentId === agent.id}
													className={cn(
														'pr-8 transition-all',
														'data-[active=true]:bg-primary/16 data-[active=true]:text-primary data-[active=true]:font-semibold data-[active=true]:shadow-sm data-[active=true]:ring-1 data-[active=true]:ring-primary/35',
													)}
												>
													<button
														type="button"
														onClick={() => onAgentSelect(repo, agent.id)}
														title={agent.name}
													>
														<Bot
															className={cn(
																'size-3.5',
																selectedAgentId === agent.id && 'text-primary',
															)}
														/>
														<span>{agent.name}</span>
													</button>
												</SidebarMenuSubButton>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="absolute top-1/2 right-1 size-5 -translate-y-1/2 text-sidebar-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover/menu-sub-item:opacity-100"
													disabled={isDeletingAgentId === agent.id}
													onClick={event => {
														event.stopPropagation();
														void onDeleteAgent(agent);
													}}
													title={`Delete ${agent.name}`}
												>
													<Trash2 className="size-3.5" />
												</Button>
											</div>
										</ContextMenuTrigger>
										<ContextMenuContent>
											<ContextMenuItem
												onClick={() => {
													setAgentToRename(agent);
													setRenameAgentName(agent.name);
													setIsRenameAgentDialogOpen(true);
												}}
											>
												<Pencil className="size-4" />
												Rename
											</ContextMenuItem>
											<ContextMenuSeparator />
											<ContextMenuItem
												variant="destructive"
												disabled={isDeletingAgentId === agent.id}
												onClick={() => void onDeleteAgent(agent)}
											>
												<Trash2 className="size-4" />
												Delete
											</ContextMenuItem>
										</ContextMenuContent>
									</ContextMenu>
								</SidebarMenuSubItem>
							))
						) : (
							<SidebarMenuSubItem>
								<p className="px-2 py-1 text-xs text-sidebar-foreground/60">
									No agents yet
								</p>
							</SidebarMenuSubItem>
						)}
					</SidebarMenuSub>
				</CollapsibleContent>
			</Collapsible>
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<SidebarMenuAction
						showOnHover
						onClick={event => {
							event.stopPropagation();
						}}
					>
						<Trash2 className="size-3.5" />
					</SidebarMenuAction>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove repository</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove{' '}
							<span className="font-medium text-foreground">{repo.name}</span>{' '}
							from the list? This will not delete any files on disk.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => handleRemoveRepo(repo.id, onReposChange)}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<Dialog
				open={isRenameAgentDialogOpen}
				onOpenChange={open => {
					setIsRenameAgentDialogOpen(open);
					if (!open) {
						setAgentToRename(null);
						setRenameAgentName('');
					}
				}}
			>
				<DialogContent>
					<form onSubmit={event => void handleRenameAgent(event)}>
						<DialogHeader>
							<DialogTitle>Rename agent</DialogTitle>
							<DialogDescription>
								Choose a new name for this agent.
							</DialogDescription>
						</DialogHeader>
						<div className="py-4">
							<Input
								autoFocus
								value={renameAgentName}
								onChange={event => setRenameAgentName(event.target.value)}
								placeholder="Agent name"
								disabled={isRenamingSelectedAgent}
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsRenameAgentDialogOpen(false)}
								disabled={isRenamingSelectedAgent}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									isRenamingSelectedAgent || renameAgentName.trim().length === 0
								}
							>
								{isRenamingSelectedAgent ? 'Renaming...' : 'Rename'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={isBranchDialogOpen}
				onOpenChange={open => {
					setIsBranchDialogOpen(open);
					if (open) {
						setBranchSearchQuery('');
						void refreshBranchDialogData();
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change branch</DialogTitle>
						<DialogDescription>
							Switch, create, and remove local branches for{' '}
							<span className="font-medium text-foreground">{repo.name}</span>.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
							<p>
								Current branch:{' '}
								<span className="font-medium text-foreground">
									{currentBranchName ?? 'Unknown'}
								</span>
							</p>
							{workingTreeStatus?.hasChanges && (
								<p className="mt-1 text-amber-700 dark:text-amber-300">
									This repo has uncommitted changes.
								</p>
							)}
						</div>

						<div className="space-y-2">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
								Local branches
							</p>
							<Input
								value={branchSearchQuery}
								onChange={event => setBranchSearchQuery(event.target.value)}
								placeholder="Search branches..."
								className="h-8"
							/>
							<ScrollArea className="h-56 rounded-md border">
								<div className="space-y-1 p-2">
									{isBranchDataLoading ? (
										<p className="px-1 py-1 text-xs text-muted-foreground">
											Loading branches...
										</p>
									) : localBranches.length === 0 ? (
										<p className="px-1 py-1 text-xs text-muted-foreground">
											No local branches found.
										</p>
									) : filteredLocalBranches.length === 0 ? (
										<p className="px-1 py-1 text-xs text-muted-foreground">
											No branches match your search.
										</p>
									) : (
										filteredLocalBranches.map(localBranch => {
											const isSelected =
												selectedBranchName === localBranch.name;
											return (
												<button
													key={localBranch.name}
													type="button"
													className={cn(
														'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
														isSelected && 'bg-accent',
													)}
													onClick={() =>
														setSelectedBranchName(localBranch.name)
													}
												>
													<GitBranch className="size-3.5 text-muted-foreground" />
													<span className="truncate">{localBranch.name}</span>
													{localBranch.isCurrent && (
														<span className="ml-auto text-[10px] text-muted-foreground">
															current
														</span>
													)}
													{isSelected && <Check className="size-3.5" />}
												</button>
											);
										})
									)}
								</div>
							</ScrollArea>
						</div>

						<div className="space-y-2 rounded-md border p-3">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
								When switching with uncommitted changes
							</p>
							<div className="flex gap-2">
								<Button
									type="button"
									size="sm"
									variant={moveChangesOnSwitch ? 'default' : 'outline'}
									onClick={() => setMoveChangesOnSwitch(true)}
									className="flex-1"
								>
									Move changes with me
								</Button>
								<Button
									type="button"
									size="sm"
									variant={moveChangesOnSwitch ? 'outline' : 'default'}
									onClick={() => setMoveChangesOnSwitch(false)}
									className="flex-1"
								>
									Keep on old branch
								</Button>
							</div>
							{workingTreeStatus?.hasChanges && !moveChangesOnSwitch && (
								<p className="text-xs text-muted-foreground">
									Keeping changes uses stash before switching so your current
									working tree stays clean on the new branch.
								</p>
							)}
							<Button
								type="button"
								size="sm"
								onClick={() => void handleSwitchBranch()}
								disabled={!canSwitchBranch || isSwitchingBranch}
								className="w-full"
							>
								{isSwitchingBranch && (
									<LoaderCircle className="size-3.5 animate-spin" />
								)}
								Switch to selected branch
							</Button>
						</div>

						<div className="space-y-2 rounded-md border p-3">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
								Create branch
							</p>
							<div className="flex gap-2">
								<Input
									value={newBranchName}
									onChange={event => setNewBranchName(event.target.value)}
									placeholder="feature/my-branch"
									disabled={isCreatingBranch}
								/>
								<Button
									type="button"
									onClick={() => void handleCreateBranch()}
									disabled={
										newBranchName.trim().length === 0 || isCreatingBranch
									}
								>
									{isCreatingBranch && (
										<LoaderCircle className="size-3.5 animate-spin" />
									)}
									Create
								</Button>
							</div>
						</div>

						<div className="space-y-2 rounded-md border border-destructive/30 p-3">
							<p className="text-xs font-medium text-destructive uppercase tracking-wide">
								Remove branch
							</p>
							<div className="flex gap-2">
								<Button
									type="button"
									size="sm"
									variant={deleteForce ? 'outline' : 'default'}
									onClick={() => setDeleteForce(false)}
									className="flex-1"
								>
									Safe delete
								</Button>
								<Button
									type="button"
									size="sm"
									variant={deleteForce ? 'default' : 'outline'}
									onClick={() => setDeleteForce(true)}
									className="flex-1"
								>
									Force delete
								</Button>
							</div>
							<Button
								type="button"
								size="sm"
								variant="destructive"
								onClick={() => void handleDeleteBranch()}
								disabled={!canDeleteBranch || isDeletingBranch}
								className="w-full"
							>
								{isDeletingBranch && (
									<LoaderCircle className="size-3.5 animate-spin" />
								)}
								Delete selected branch
							</Button>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setIsBranchDialogOpen(false)}
						>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</SidebarMenuItem>
	);
}

// --- Drop zone hook to fix dragLeave on child elements ---

function useDropZone(onDrop: (repoId: number) => Promise<void>) {
	const [isDragOver, setIsDragOver] = useState(false);
	const dragCounterReference = useRef(0);
	const handleDragEnter = (event: React.DragEvent) => {
		event.preventDefault();
		dragCounterReference.current += 1;
		if (dragCounterReference.current === 1) {
			setIsDragOver(true);
		}
	};
	const handleDragLeave = () => {
		dragCounterReference.current -= 1;
		if (dragCounterReference.current === 0) {
			setIsDragOver(false);
		}
	};
	const handleDrop = async (event: React.DragEvent) => {
		event.preventDefault();
		dragCounterReference.current = 0;
		setIsDragOver(false);
		const repoId = getRepoIdFromDragEvent(event);
		if (repoId === null) return;
		await onDrop(repoId);
	};

	const handlers = {
		// Capture handlers ensure nested interactive children can't block drop acceptance.
		onDragEnterCapture: handleDragEnter,
		onDragOverCapture: handleDropZoneDragOver,
		onDragLeaveCapture: handleDragLeave,
		onDropCapture: handleDrop,
	};

	return {isDragOver, handlers};
}

// --- Group Section ---

function GroupSection({
	group,
	repos,
	repoSyncStatusById,
	repoBranchById,
	agentsByRepoId,
	agentsLoadingByRepoId,
	agentsErrorByRepoId,
	allGroups,
	activeDropZone,
	selectedRepoId,
	selectedAgentId,
	onRepoSelect,
	onAgentSelect,
	onCreateAgent,
	onDeleteAgent,
	onRenameAgent,
	isCreatingAgentRepoId,
	isDeletingAgentId,
	isRenamingAgentId,
	onReposChange,
	onGroupsChange,
	onAddRepo,
	onPointerDragStart,
	onPullRepo,
	onCheckRepoUpdates,
}: {
	group: Group;
	repos: Repo[];
	repoSyncStatusById: Record<number, RepoSyncStatus>;
	repoBranchById: Record<number, string>;
	agentsByRepoId: Record<number, Agent[]>;
	agentsLoadingByRepoId: Record<number, boolean>;
	agentsErrorByRepoId: Record<number, string | null>;
	allGroups: Group[];
	activeDropZone: DropZone | null;
	selectedRepoId: number | null;
	selectedAgentId: number | null;
	onRepoSelect: (repo: Repo) => void;
	onAgentSelect: (repo: Repo, agentId: number) => void;
	onCreateAgent: (repoId: number, name: string) => Promise<void>;
	onDeleteAgent: (agent: Agent) => Promise<void>;
	onRenameAgent: (agent: Agent, name: string) => Promise<void>;
	isCreatingAgentRepoId: number | null;
	isDeletingAgentId: number | null;
	isRenamingAgentId: number | null;
	onReposChange: () => void;
	onGroupsChange: () => void;
	onAddRepo: (groupId: number) => void;
	onPointerDragStart: (event: React.PointerEvent, repo: Repo) => void;
	onPullRepo: (repo: Repo) => Promise<void>;
	onCheckRepoUpdates: () => void;
}) {
	const [isOpen, setIsOpen] = useState(true);
	const [isRenaming, setIsRenaming] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [renameValue, setRenameValue] = useState(group.name);

	const {isDragOver, handlers: dropHandlers} = useDropZone(
		async (repoId: number) => {
			try {
				await invoke('move_repo_to_group', {
					repoId,
					groupId: group.id,
				});
				onReposChange();
			} catch (error) {
				toast.error(String(error));
			}
		},
	);

	const handleRename = useCallback(
		async (event: FormEvent) => {
			event.preventDefault();
			const trimmed = renameValue.trim();
			if (!trimmed) return;
			try {
				await invoke('rename_group', {id: group.id, name: trimmed});
				onGroupsChange();
				setIsRenaming(false);
			} catch (error) {
				toast.error(String(error));
			}
		},
		[group.id, renameValue, onGroupsChange],
	);

	const handleDeleteGroup = useCallback(async () => {
		try {
			await invoke('delete_group', {id: group.id});
			toast.success('Group deleted');
			onGroupsChange();
			onReposChange();
		} catch (error) {
			toast.error(String(error));
		}
	}, [group.id, onGroupsChange, onReposChange]);
	const isPointerDragOver =
		activeDropZone?.type === 'group' && activeDropZone.groupId === group.id;

	return (
		<>
			<SidebarGroup
				{...dropHandlers}
				data-drop-zone="group"
				data-drop-group-id={group.id}
				className={
					isDragOver || isPointerDragOver
						? 'rounded-md ring-2 ring-sidebar-ring ring-offset-1'
						: ''
				}
			>
				<Collapsible open={isOpen} onOpenChange={setIsOpen}>
					<div className="flex items-center">
						<CollapsibleTrigger asChild>
							<SidebarGroupLabel className="flex-1 cursor-pointer select-none">
								<ChevronRight
									className={`size-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
								/>
								<span className="ml-1">{group.name}</span>
								<span className="ml-auto text-xs text-sidebar-foreground/50">
									{repos.length}
								</span>
							</SidebarGroupLabel>
						</CollapsibleTrigger>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="size-5 shrink-0 mr-2 text-sidebar-foreground/70 hover:text-sidebar-foreground"
								>
									<MoreHorizontal className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" side="right">
								<DropdownMenuItem onClick={() => onAddRepo(group.id)}>
									<Plus className="size-4" />
									Add repository
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => {
										setRenameValue(group.name);
										setIsRenaming(true);
									}}
								>
									<Pencil className="size-4" />
									Rename
								</DropdownMenuItem>
								<DropdownMenuItem
									variant="destructive"
									onClick={() => setIsDeleteDialogOpen(true)}
								>
									<Trash2 className="size-4" />
									Delete group
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<CollapsibleContent>
						<SidebarGroupContent>
							<SidebarMenu>
								{repos.length === 0 ? (
									<p className="px-4 py-2 text-xs text-muted-foreground">
										Drag repos here
									</p>
								) : (
									repos.map(repo => (
										<DraggableRepoItem
											key={repo.id}
											repo={repo}
											syncStatus={repoSyncStatusById[repo.id]}
											branch={repoBranchById[repo.id]}
											isActive={repo.id === selectedRepoId}
											selectedAgentId={selectedAgentId}
											agents={agentsByRepoId[repo.id] ?? []}
											isAgentsLoading={Boolean(agentsLoadingByRepoId[repo.id])}
											agentsError={agentsErrorByRepoId[repo.id] ?? null}
											isCreatingAgentRepoId={isCreatingAgentRepoId}
											isDeletingAgentId={isDeletingAgentId}
											isRenamingAgentId={isRenamingAgentId}
											groups={allGroups}
											onRepoSelect={onRepoSelect}
											onAgentSelect={onAgentSelect}
											onCreateAgent={onCreateAgent}
											onDeleteAgent={onDeleteAgent}
											onRenameAgent={onRenameAgent}
											onReposChange={onReposChange}
											onPointerDragStart={onPointerDragStart}
											onPullRepo={onPullRepo}
											onCheckRepoUpdates={onCheckRepoUpdates}
										/>
									))
								)}
							</SidebarMenu>
						</SidebarGroupContent>
					</CollapsibleContent>
				</Collapsible>
			</SidebarGroup>

			{/* Rename Dialog */}
			<Dialog open={isRenaming} onOpenChange={setIsRenaming}>
				<DialogContent>
					<form onSubmit={handleRename}>
						<DialogHeader>
							<DialogTitle>Rename group</DialogTitle>
							<DialogDescription>
								Enter a new name for the group.
							</DialogDescription>
						</DialogHeader>
						<div className="py-4">
							<Input
								autoFocus
								value={renameValue}
								onChange={event => setRenameValue(event.target.value)}
								placeholder="Group name"
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsRenaming(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={!renameValue.trim()}>
								Rename
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete group</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete{' '}
							<span className="font-medium text-foreground">{group.name}</span>?
							Repositories in this group will be moved to ungrouped.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={handleDeleteGroup}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// --- Ungrouped Section (drop target to remove from group) ---

function UngroupedSection({
	repos,
	groups,
	repoSyncStatusById,
	repoBranchById,
	agentsByRepoId,
	agentsLoadingByRepoId,
	agentsErrorByRepoId,
	activeDropZone,
	selectedRepoId,
	selectedAgentId,
	onRepoSelect,
	onAgentSelect,
	onCreateAgent,
	onDeleteAgent,
	onRenameAgent,
	isCreatingAgentRepoId,
	isDeletingAgentId,
	isRenamingAgentId,
	onReposChange,
	onPointerDragStart,
	onPullRepo,
	onCheckRepoUpdates,
}: {
	repos: Repo[];
	groups: Group[];
	repoSyncStatusById: Record<number, RepoSyncStatus>;
	repoBranchById: Record<number, string>;
	agentsByRepoId: Record<number, Agent[]>;
	agentsLoadingByRepoId: Record<number, boolean>;
	agentsErrorByRepoId: Record<number, string | null>;
	activeDropZone: DropZone | null;
	selectedRepoId: number | null;
	selectedAgentId: number | null;
	onRepoSelect: (repo: Repo) => void;
	onAgentSelect: (repo: Repo, agentId: number) => void;
	onCreateAgent: (repoId: number, name: string) => Promise<void>;
	onDeleteAgent: (agent: Agent) => Promise<void>;
	onRenameAgent: (agent: Agent, name: string) => Promise<void>;
	isCreatingAgentRepoId: number | null;
	isDeletingAgentId: number | null;
	isRenamingAgentId: number | null;
	onReposChange: () => void;
	onPointerDragStart: (event: React.PointerEvent, repo: Repo) => void;
	onPullRepo: (repo: Repo) => Promise<void>;
	onCheckRepoUpdates: () => void;
}) {
	const {isDragOver, handlers: dropHandlers} = useDropZone(
		async (repoId: number) => {
			try {
				await invoke('move_repo_to_group', {
					repoId,
					groupId: null,
				});
				onReposChange();
			} catch (error) {
				toast.error(String(error));
			}
		},
	);
	const isPointerDragOver = activeDropZone?.type === 'ungrouped';

	return (
		<SidebarGroup
			{...dropHandlers}
			data-drop-zone="ungrouped"
			className={
				isDragOver || isPointerDragOver
					? 'rounded-md ring-2 ring-sidebar-ring ring-offset-1'
					: ''
			}
		>
			<SidebarGroupLabel>Ungrouped</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{repos.map(repo => (
						<DraggableRepoItem
							key={repo.id}
							repo={repo}
							syncStatus={repoSyncStatusById[repo.id]}
							branch={repoBranchById[repo.id]}
							isActive={repo.id === selectedRepoId}
							selectedAgentId={selectedAgentId}
							agents={agentsByRepoId[repo.id] ?? []}
							isAgentsLoading={Boolean(agentsLoadingByRepoId[repo.id])}
							agentsError={agentsErrorByRepoId[repo.id] ?? null}
							isCreatingAgentRepoId={isCreatingAgentRepoId}
							isDeletingAgentId={isDeletingAgentId}
							isRenamingAgentId={isRenamingAgentId}
							groups={groups}
							onRepoSelect={onRepoSelect}
							onAgentSelect={onAgentSelect}
							onCreateAgent={onCreateAgent}
							onDeleteAgent={onDeleteAgent}
							onRenameAgent={onRenameAgent}
							onReposChange={onReposChange}
							onPointerDragStart={onPointerDragStart}
							onPullRepo={onPullRepo}
							onCheckRepoUpdates={onCheckRepoUpdates}
						/>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

// --- Main Sidebar ---

export function RepoSidebar({
	repos,
	groups,
	repoSyncStatusById,
	repoBranchById,
	agentsByRepoId,
	agentsLoadingByRepoId,
	agentsErrorByRepoId,
	isCheckingRepoUpdates,
	selectedRepoId,
	selectedAgentId,
	onRepoSelect,
	onAgentSelect,
	onCreateAgent,
	onDeleteAgent,
	onRenameAgent,
	isCreatingAgentRepoId,
	isDeletingAgentId,
	isRenamingAgentId,
	onReposChange,
	onGroupsChange,
	onCheckRepoUpdates,
	onPullRepo,
}: RepoSidebarProperties) {
	const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
	const [isAddRepoOpen, setIsAddRepoOpen] = useState(false);
	const [addRepoGroupId, setAddRepoGroupId] = useState<number | null>(null);
	const [newGroupName, setNewGroupName] = useState('');
	const inputReference = useRef<HTMLInputElement>(null);
	const [activeDropZone, setActiveDropZone] = useState<DropZone | null>(null);
	const [isPointerDragging, setIsPointerDragging] = useState(false);

	const ungroupedRepos = repos.filter(r => r.group_id === null);

	const handleCreateGroup = useCallback(
		async (event: FormEvent) => {
			event.preventDefault();
			const trimmed = newGroupName.trim();
			if (!trimmed) return;
			try {
				await invoke('create_group', {name: trimmed});
				toast.success('Group created');
				setNewGroupName('');
				setIsCreateGroupOpen(false);
				onGroupsChange();
			} catch (error) {
				toast.error(String(error));
			}
		},
		[newGroupName, onGroupsChange],
	);
	const handlePointerDragStart = useCallback(
		(event: React.PointerEvent, repo: Repo) => {
			if (event.button !== 0) return;
			const startX = event.clientX;
			const startY = event.clientY;
			let dragging = false;

			const clearPointerDragState = () => {
				setActiveDropZone(null);
				setIsPointerDragging(false);
			};

			const handlePointerMove = (moveEvent: PointerEvent) => {
				const distanceX = Math.abs(moveEvent.clientX - startX);
				const distanceY = Math.abs(moveEvent.clientY - startY);
				if (!dragging && distanceX + distanceY < 6) {
					return;
				}

				if (!dragging) {
					dragging = true;
					setIsPointerDragging(true);
				}

				const target = document.elementFromPoint(
					moveEvent.clientX,
					moveEvent.clientY,
				);
				const zone = readDropZoneFromElement(target);
				setActiveDropZone(zone);
				moveEvent.preventDefault();
			};

			const finishDrag = async (upEvent: PointerEvent) => {
				globalThis.removeEventListener('pointermove', handlePointerMove);
				globalThis.removeEventListener('pointerup', finishDrag);
				globalThis.removeEventListener('pointercancel', finishDrag);

				if (!dragging) {
					clearPointerDragState();
					return;
				}

				const target = document.elementFromPoint(
					upEvent.clientX,
					upEvent.clientY,
				);
				const zone = readDropZoneFromElement(target);
				clearPointerDragState();

				if (!zone) {
					return;
				}

				try {
					await (zone.type === 'group'
						? invoke('move_repo_to_group', {
								repoId: repo.id,
								groupId: zone.groupId,
							})
						: invoke('move_repo_to_group', {
								repoId: repo.id,
								groupId: null,
							}));
					onReposChange();
				} catch (error) {
					toast.error(String(error));
				}
			};

			globalThis.addEventListener('pointermove', handlePointerMove);
			globalThis.addEventListener('pointerup', finishDrag);
			globalThis.addEventListener('pointercancel', finishDrag);
		},
		[onReposChange],
	);

	return (
		<Sidebar>
			<SidebarHeader className="border-b border-sidebar-border">
				<div className="flex items-center justify-between">
					<span className="text-sm font-semibold">Repositories</span>
					<div className="flex items-center gap-0.5">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() => setIsCreateGroupOpen(true)}
								>
									<FolderPlus className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top">New group</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={onCheckRepoUpdates}
									disabled={isCheckingRepoUpdates}
								>
									<RefreshCw
										className={`size-4 ${isCheckingRepoUpdates ? 'animate-spin' : ''}`}
									/>
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top">Check updates</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() => {
										setAddRepoGroupId(null);
										setIsAddRepoOpen(true);
									}}
								>
									<Plus className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top">Add repository</TooltipContent>
						</Tooltip>
					</div>
				</div>
			</SidebarHeader>
			<SidebarContent>
				{/* Plain div instead of ScrollArea to avoid Radix viewport interference with drag events */}
				<div
					className={`flex-1 overflow-y-auto ${isPointerDragging ? 'cursor-grabbing' : ''}`}
				>
					{/* Group sections */}
					{groups.map(group => (
						<GroupSection
							key={group.id}
							group={group}
							repos={repos.filter(r => r.group_id === group.id)}
							repoSyncStatusById={repoSyncStatusById}
							repoBranchById={repoBranchById}
							agentsByRepoId={agentsByRepoId}
							agentsLoadingByRepoId={agentsLoadingByRepoId}
							agentsErrorByRepoId={agentsErrorByRepoId}
							allGroups={groups}
							activeDropZone={activeDropZone}
							selectedRepoId={selectedRepoId}
							selectedAgentId={selectedAgentId}
							onRepoSelect={onRepoSelect}
							onAgentSelect={onAgentSelect}
							onCreateAgent={onCreateAgent}
							onDeleteAgent={onDeleteAgent}
							onRenameAgent={onRenameAgent}
							isCreatingAgentRepoId={isCreatingAgentRepoId}
							isDeletingAgentId={isDeletingAgentId}
							isRenamingAgentId={isRenamingAgentId}
							onReposChange={onReposChange}
							onGroupsChange={onGroupsChange}
							onAddRepo={groupId => {
								setAddRepoGroupId(groupId);
								setIsAddRepoOpen(true);
							}}
							onPointerDragStart={handlePointerDragStart}
							onPullRepo={onPullRepo}
							onCheckRepoUpdates={onCheckRepoUpdates}
						/>
					))}

					{/* Ungrouped repos */}
					{ungroupedRepos.length > 0 && (
						<UngroupedSection
							repos={ungroupedRepos}
							groups={groups}
							repoSyncStatusById={repoSyncStatusById}
							repoBranchById={repoBranchById}
							agentsByRepoId={agentsByRepoId}
							agentsLoadingByRepoId={agentsLoadingByRepoId}
							agentsErrorByRepoId={agentsErrorByRepoId}
							activeDropZone={activeDropZone}
							selectedRepoId={selectedRepoId}
							selectedAgentId={selectedAgentId}
							onRepoSelect={onRepoSelect}
							onAgentSelect={onAgentSelect}
							onCreateAgent={onCreateAgent}
							onDeleteAgent={onDeleteAgent}
							onRenameAgent={onRenameAgent}
							isCreatingAgentRepoId={isCreatingAgentRepoId}
							isDeletingAgentId={isDeletingAgentId}
							isRenamingAgentId={isRenamingAgentId}
							onReposChange={onReposChange}
							onPointerDragStart={handlePointerDragStart}
							onPullRepo={onPullRepo}
							onCheckRepoUpdates={onCheckRepoUpdates}
						/>
					)}
				</div>
			</SidebarContent>

			<AddRepoDialog
				open={isAddRepoOpen}
				onOpenChange={open => {
					setIsAddRepoOpen(open);
					if (!open) {
						setAddRepoGroupId(null);
					}
				}}
				onReposChange={onReposChange}
				groupId={addRepoGroupId ?? undefined}
			/>

			{/* Create Group Dialog */}
			<Dialog open={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
				<DialogContent>
					<form onSubmit={handleCreateGroup}>
						<DialogHeader>
							<DialogTitle>Create group</DialogTitle>
							<DialogDescription>
								Groups help you organize your repositories.
							</DialogDescription>
						</DialogHeader>
						<div className="py-4">
							<Input
								ref={inputReference}
								autoFocus
								value={newGroupName}
								onChange={event => setNewGroupName(event.target.value)}
								placeholder="Group name"
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsCreateGroupOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={!newGroupName.trim()}>
								Create
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</Sidebar>
	);
}
