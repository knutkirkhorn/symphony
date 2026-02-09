export type Repo = {
	id: number;
	name: string;
	path: string;
	group_id: number | null;
	created_at: string;
};

export type RepoSyncStatus = {
	has_remote: boolean;
	has_upstream: boolean;
	ahead: number;
	behind: number;
	can_pull: boolean;
	error: string | null;
};

export type Group = {
	id: number;
	name: string;
	sort_order: number;
	created_at: string;
};

export type GitCommit = {
	hash: string;
	short_hash: string;
	author_name: string;
	author_email: string;
	author_date: string;
	subject: string;
};

export type GitCommitFileDiff = {
	path: string;
	diff: string;
};

export type Agent = {
	id: number;
	repo_id: number;
	name: string;
	created_at: string;
};

export type AgentConversationEntry = {
	id: string;
	role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
	text: string;
};
