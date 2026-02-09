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
