export type Repo = {
	id: number;
	name: string;
	path: string;
	group_id: number | null;
	created_at: string;
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
