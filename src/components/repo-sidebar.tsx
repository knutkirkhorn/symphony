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
import type {Group, Repo, RepoSyncStatus} from '@/lib/types';
import {cn} from '@/lib/utils';
import {invoke} from '@tauri-apps/api/core';
import {
	ArrowRightLeft,
	ChevronRight,
	Download,
	FolderGit2,
	FolderPlus,
	MoreHorizontal,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from 'lucide-react';
import {useCallback, useRef, useState, type FormEvent} from 'react';
import {toast} from 'sonner';

type RepoSidebarProperties = {
	repos: Repo[];
	groups: Group[];
	repoSyncStatusById: Record<number, RepoSyncStatus>;
	isCheckingRepoUpdates: boolean;
	selectedRepoId: number | null;
	onRepoSelect: (repo: Repo) => void;
	onReposChange: () => void;
	onGroupsChange: () => void;
	onCheckRepoUpdates: () => void;
	onPullRepo: (repo: Repo) => Promise<void>;
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
	isActive,
	groups,
	onRepoSelect,
	onReposChange,
	onPointerDragStart,
	onPullRepo,
}: {
	repo: Repo;
	syncStatus?: RepoSyncStatus;
	isActive: boolean;
	groups: Group[];
	onRepoSelect: (repo: Repo) => void;
	onReposChange: () => void;
	onPointerDragStart: (event: React.PointerEvent, repo: Repo) => void;
	onPullRepo: (repo: Repo) => Promise<void>;
}) {
	// Groups the repo can be moved to (exclude the one it's already in)
	const moveTargets = groups.filter(g => g.id !== repo.group_id);
	const canMoveToUngrouped = repo.group_id !== null;

	return (
		<SidebarMenuItem className="select-none cursor-grab active:cursor-grabbing">
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<SidebarMenuButton
						isActive={isActive}
						onClick={() => onRepoSelect(repo)}
						onPointerDown={event => onPointerDragStart(event, repo)}
						title={repo.path}
						className={cn(
							'select-none cursor-grab active:cursor-grabbing',
							isActive &&
								'bg-primary/12 text-foreground font-semibold ring-1 ring-primary/35 shadow-sm [&>svg]:text-primary',
						)}
					>
						<FolderGit2 className="size-4" />
						<span>{repo.name}</span>
						{syncStatus?.can_pull && (
							<span className="ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
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
	allGroups,
	activeDropZone,
	selectedRepoId,
	onRepoSelect,
	onReposChange,
	onGroupsChange,
	onAddRepo,
	onPointerDragStart,
	onPullRepo,
}: {
	group: Group;
	repos: Repo[];
	repoSyncStatusById: Record<number, RepoSyncStatus>;
	allGroups: Group[];
	activeDropZone: DropZone | null;
	selectedRepoId: number | null;
	onRepoSelect: (repo: Repo) => void;
	onReposChange: () => void;
	onGroupsChange: () => void;
	onAddRepo: (groupId: number) => void;
	onPointerDragStart: (event: React.PointerEvent, repo: Repo) => void;
	onPullRepo: (repo: Repo) => Promise<void>;
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
											isActive={repo.id === selectedRepoId}
											groups={allGroups}
											onRepoSelect={onRepoSelect}
											onReposChange={onReposChange}
											onPointerDragStart={onPointerDragStart}
											onPullRepo={onPullRepo}
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
	activeDropZone,
	selectedRepoId,
	onRepoSelect,
	onReposChange,
	onPointerDragStart,
	onPullRepo,
}: {
	repos: Repo[];
	groups: Group[];
	repoSyncStatusById: Record<number, RepoSyncStatus>;
	activeDropZone: DropZone | null;
	selectedRepoId: number | null;
	onRepoSelect: (repo: Repo) => void;
	onReposChange: () => void;
	onPointerDragStart: (event: React.PointerEvent, repo: Repo) => void;
	onPullRepo: (repo: Repo) => Promise<void>;
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
							isActive={repo.id === selectedRepoId}
							groups={groups}
							onRepoSelect={onRepoSelect}
							onReposChange={onReposChange}
							onPointerDragStart={onPointerDragStart}
							onPullRepo={onPullRepo}
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
	isCheckingRepoUpdates,
	selectedRepoId,
	onRepoSelect,
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
							<TooltipContent side="right">New group</TooltipContent>
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
							<TooltipContent side="right">Check updates</TooltipContent>
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
							<TooltipContent side="right">Add repository</TooltipContent>
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
							allGroups={groups}
							activeDropZone={activeDropZone}
							selectedRepoId={selectedRepoId}
							onRepoSelect={onRepoSelect}
							onReposChange={onReposChange}
							onGroupsChange={onGroupsChange}
							onAddRepo={groupId => {
								setAddRepoGroupId(groupId);
								setIsAddRepoOpen(true);
							}}
							onPointerDragStart={handlePointerDragStart}
							onPullRepo={onPullRepo}
						/>
					))}

					{/* Ungrouped repos */}
					{ungroupedRepos.length > 0 && (
						<UngroupedSection
							repos={ungroupedRepos}
							groups={groups}
							repoSyncStatusById={repoSyncStatusById}
							activeDropZone={activeDropZone}
							selectedRepoId={selectedRepoId}
							onRepoSelect={onRepoSelect}
							onReposChange={onReposChange}
							onPointerDragStart={handlePointerDragStart}
							onPullRepo={onPullRepo}
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
